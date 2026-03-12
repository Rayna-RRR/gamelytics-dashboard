#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "Gamelytics"
OUTPUT_DIR = ROOT / "data" / "processed"
LEGACY_OUTPUT_FILE = ROOT / "data" / "dashboard-metrics.json"

REG_FILE = RAW_DIR / "reg_data.csv"
AUTH_FILE = RAW_DIR / "auth_data.csv"
AB_FILE = RAW_DIR / "ab_test.csv"

RETENTION_WINDOWS = [1, 3, 7, 14, 30]
LEGACY_RETENTION_DAYS = list(range(1, 31))
# The page focuses on recent monthly cohorts for readability.
# Older cohorts are still exported to processed outputs for audit and interview discussion.
LEGACY_COHORT_MONTHS = [f"2020-{month:02d}" for month in range(1, 9)]
ACTIVITY_WINDOW_DAYS = 30
TIMEZONE = "Asia/Shanghai"


def round_num(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def percent(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return numerator / denominator * 100


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def local_day(series: pd.Series) -> pd.Series:
    """Convert unix seconds into China-local calendar dates."""
    return (
        pd.to_datetime(series, unit="s", utc=True)
        .dt.tz_convert(TIMEZONE)
        .dt.normalize()
        .dt.tz_localize(None)
    )


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def build_weekly_series(daily_metrics: pd.DataFrame) -> list[dict[str, float]]:
    daily = daily_metrics.copy()
    daily["date"] = pd.to_datetime(daily["date"])
    daily_2020 = daily[daily["date"] >= pd.Timestamp("2020-01-01")].set_index("date")["dau"]
    weekly = daily_2020.resample("W-SUN").mean()
    return [{"d": idx.strftime("%m/%d"), "v": round_num(value, 2)} for idx, value in weekly.items()]


def load_sources() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    reg = pd.read_csv(REG_FILE, sep=";", usecols=["reg_ts", "uid"])
    auth = pd.read_csv(AUTH_FILE, sep=";", usecols=["auth_ts", "uid"])
    ab = pd.read_csv(AB_FILE, sep=";", usecols=["user_id", "revenue", "testgroup"])

    reg["reg_date"] = local_day(reg["reg_ts"])
    auth["auth_date"] = local_day(auth["auth_ts"])

    return reg, auth, ab


def build_daily_metrics(reg: pd.DataFrame, auth_user_day: pd.DataFrame) -> pd.DataFrame:
    registrations = reg.groupby("reg_date")["uid"].nunique().rename("registrations")
    dau = auth_user_day.groupby("auth_date")["uid"].nunique().rename("dau")

    start_date = min(reg["reg_date"].min(), auth_user_day["auth_date"].min())
    end_date = max(reg["reg_date"].max(), auth_user_day["auth_date"].max())
    date_index = pd.date_range(start_date, end_date, freq="D")

    daily = pd.DataFrame(index=date_index)
    daily.index.name = "date"
    daily = daily.join(registrations, how="left").join(dau, how="left").fillna(0)
    daily["registrations"] = daily["registrations"].astype(int)
    daily["dau"] = daily["dau"].astype(int)
    daily = daily.reset_index()
    daily["date"] = daily["date"].dt.strftime("%Y-%m-%d")
    return daily


def build_retention_tables(
    reg: pd.DataFrame,
    auth_user_day: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    reg_users = reg[["uid", "reg_date"]].copy()
    reg_users["cohort_date"] = reg_users["reg_date"].values.astype("datetime64[M]")
    reg_users["cohort_label"] = reg_users["cohort_date"].dt.strftime("%Y-%m")

    # Exact-day retention:
    # a user is retained on Dn only if they logged in exactly n calendar days after registration.
    retention_events = auth_user_day.merge(reg_users, on="uid", how="inner")
    retention_events["offset_day"] = (retention_events["auth_date"] - retention_events["reg_date"]).dt.days
    retention_events = retention_events[
        (retention_events["offset_day"] >= 1) & (retention_events["offset_day"] <= LEGACY_RETENTION_DAYS[-1])
    ]

    max_auth_date = auth_user_day["auth_date"].max()
    total_registered_users = int(reg_users["uid"].nunique())
    returned_overall = retention_events.groupby("offset_day")["uid"].nunique()

    overall_rows = []
    for window in LEGACY_RETENTION_DAYS:
        eligible_mask = reg_users["reg_date"] <= max_auth_date - pd.Timedelta(days=window)
        eligible_users = int(eligible_mask.sum())
        retained_users = int(returned_overall.get(window, 0))
        overall_rows.append(
            {
                "day": window,
                "total_registered_users": total_registered_users,
                "eligible_users": eligible_users,
                "retained_users": retained_users,
                "retention_rate": round_num(percent(retained_users, eligible_users), 4),
                # Explicitly mark incomplete windows: recent registrants are not yet observable.
                "is_complete": bool(eligible_users == total_registered_users),
            }
        )

    cohort_sizes = (
        reg_users.groupby(["cohort_date", "cohort_label"])["uid"]
        .nunique()
        .reset_index(name="cohort_size")
        .sort_values("cohort_date")
    )
    cohort_returned = (
        retention_events.groupby(["cohort_date", "cohort_label", "offset_day"])["uid"]
        .nunique()
        .unstack(fill_value=0)
    )

    cohort_rows = []
    for cohort in cohort_sizes.itertuples(index=False):
        cohort_date = pd.Timestamp(cohort.cohort_date)
        cohort_mask = reg_users["cohort_date"] == cohort_date
        cohort_reg_dates = reg_users.loc[cohort_mask, "reg_date"]

        row = {
            "cohort_date": cohort_date.strftime("%Y-%m-%d"),
            "cohort_label": cohort.cohort_label,
            "cohort_size": int(cohort.cohort_size),
        }

        for window in RETENTION_WINDOWS:
            eligible_users = int((cohort_reg_dates <= max_auth_date - pd.Timedelta(days=window)).sum())
            retained_users = 0
            if (cohort_date, cohort.cohort_label) in cohort_returned.index and window in cohort_returned.columns:
                retained_users = int(cohort_returned.loc[(cohort_date, cohort.cohort_label), window])

            row[f"d{window}_eligible_users"] = eligible_users
            row[f"d{window}_retained_users"] = retained_users
            row[f"d{window}_retention"] = round_num(percent(retained_users, eligible_users), 4)
            row[f"d{window}_complete"] = bool(eligible_users == cohort.cohort_size)

        cohort_rows.append(row)

    overall_df = pd.DataFrame(overall_rows)
    cohort_df = pd.DataFrame(cohort_rows)
    return overall_df, cohort_df


def build_activity_segments(reg: pd.DataFrame, auth_user_day: pd.DataFrame) -> pd.DataFrame:
    as_of_date = auth_user_day["auth_date"].max()
    window_start = as_of_date - pd.Timedelta(days=ACTIVITY_WINDOW_DAYS - 1)

    # Segment users by number of active days in the last 30 natural days.
    # This keeps the output simple enough for a portfolio dashboard while still being operationally interpretable.
    recent_activity = auth_user_day[
        (auth_user_day["auth_date"] >= window_start) & (auth_user_day["auth_date"] <= as_of_date)
    ].groupby("uid").size()

    total_registered_users = int(reg["uid"].nunique())
    active_users = int(recent_activity.index.nunique())
    rows = [
        {
            "as_of_date": as_of_date.strftime("%Y-%m-%d"),
            "window_days": ACTIVITY_WINDOW_DAYS,
            "segment": "inactive_30d",
            "users": total_registered_users - active_users,
        },
        {
            "as_of_date": as_of_date.strftime("%Y-%m-%d"),
            "window_days": ACTIVITY_WINDOW_DAYS,
            "segment": "light_1_3d",
            "users": int(((recent_activity >= 1) & (recent_activity <= 3)).sum()),
        },
        {
            "as_of_date": as_of_date.strftime("%Y-%m-%d"),
            "window_days": ACTIVITY_WINDOW_DAYS,
            "segment": "mid_4_9d",
            "users": int(((recent_activity >= 4) & (recent_activity <= 9)).sum()),
        },
        {
            "as_of_date": as_of_date.strftime("%Y-%m-%d"),
            "window_days": ACTIVITY_WINDOW_DAYS,
            "segment": "core_10p_d",
            "users": int((recent_activity >= 10).sum()),
        },
    ]

    segment_df = pd.DataFrame(rows)
    segment_df["share"] = segment_df["users"].apply(lambda value: round_num(percent(value, total_registered_users), 4))
    return segment_df


def two_proportion_z_test(success_a: int, total_a: int, success_b: int, total_b: int) -> dict[str, float]:
    rate_a = success_a / total_a if total_a else 0.0
    rate_b = success_b / total_b if total_b else 0.0
    pooled = (success_a + success_b) / (total_a + total_b) if (total_a + total_b) else 0.0
    pooled_se = math.sqrt(pooled * (1 - pooled) * (1 / total_a + 1 / total_b))
    diff = rate_b - rate_a
    z_score = diff / pooled_se if pooled_se else 0.0
    return {
        "metric_definition": "payer share by testgroup",
        "test_method": "two_proportion_z_test",
        "difference_pct_points": round_num(diff * 100, 4),
        "p_value": round_num(2 * (1 - normal_cdf(abs(z_score))), 4),
    }


def welch_mean_test(
    mean_a: float,
    variance_a: float,
    total_a: int,
    mean_b: float,
    variance_b: float,
    total_b: int,
) -> dict[str, float]:
    diff = mean_b - mean_a
    se = math.sqrt((variance_a / total_a if total_a else 0.0) + (variance_b / total_b if total_b else 0.0))
    z_score = diff / se if se else 0.0
    return {
        "metric_definition": "mean revenue per user by testgroup",
        "test_method": "welch_t_normal_approx",
        "difference": round_num(diff, 4),
        "p_value": round_num(2 * (1 - normal_cdf(abs(z_score))), 4),
    }


def build_ab_summary(ab: pd.DataFrame) -> dict[str, object]:
    ab = ab.copy()
    ab["testgroup"] = ab["testgroup"].str.lower()
    ab["payer"] = ab["revenue"] > 0

    # The source data only supports sample-level result reading.
    # We intentionally avoid implying a full experiment readout with exposure checks or rollout decisions.
    group_rows = []
    group_stats = {}
    for group_name, group_df in ab.groupby("testgroup", sort=True):
        users = int(len(group_df))
        payers = int(group_df["payer"].sum())
        revenue = float(group_df["revenue"].sum())
        arpu = float(group_df["revenue"].mean()) if users else 0.0
        arppu = float(group_df.loc[group_df["payer"], "revenue"].mean()) if payers else 0.0
        variance = float(group_df["revenue"].var(ddof=1)) if users > 1 else 0.0

        group_stats[group_name] = {
            "users": users,
            "payers": payers,
            "pay_rate": round_num(percent(payers, users), 4),
            "arpu": round_num(arpu, 4),
            "arppu": round_num(arppu, 4),
            "revenue": round_num(revenue, 2),
            "variance": variance,
        }
        group_rows.append(
            {
                "group": group_name,
                "users": users,
                "payers": payers,
                "pay_rate": round_num(percent(payers, users), 4),
                "arpu": round_num(arpu, 4),
                "arppu": round_num(arppu, 4),
                "revenue": round_num(revenue, 2),
            }
        )

    total_users = int(len(ab))
    total_payers = int(ab["payer"].sum())
    total_revenue = float(ab["revenue"].sum())

    tier_masks = {
        "free": ab["revenue"] == 0,
        "super": ab["revenue"] >= 2000,
        "mid": (ab["revenue"] >= 50) & (ab["revenue"] < 2000),
    }
    tier_meta = {
        "free": {"label": "免费用户", "range": "$0", "color": "#E4E4E7"},
        "super": {"label": "超级鲸鱼 ($2K+)", "range": "$2K+", "color": "#059669"},
        "mid": {"label": "中高付费 ($50-$1,999)", "range": "$50-$1,999", "color": "#F59E0B"},
    }
    tier_rows = []
    for key in ["free", "super", "mid"]:
        subset = ab[tier_masks[key]]
        users = int(len(subset))
        revenue_sum = float(subset["revenue"].sum())
        tier_rows.append(
            {
                "key": key,
                "label": tier_meta[key]["label"],
                "range": tier_meta[key]["range"],
                "color": tier_meta[key]["color"],
                "user_count": users,
                "user_share": round_num(percent(users, total_users), 4),
                "revenue": round_num(revenue_sum, 2),
                "revenue_share": round_num(percent(revenue_sum, total_revenue), 4),
                "arppu": round_num(revenue_sum / users, 2) if users and revenue_sum else None,
            }
        )

    pay_rate_test = two_proportion_z_test(
        group_stats["a"]["payers"],
        group_stats["a"]["users"],
        group_stats["b"]["payers"],
        group_stats["b"]["users"],
    )
    arpu_test = welch_mean_test(
        group_stats["a"]["arpu"],
        group_stats["a"]["variance"],
        group_stats["a"]["users"],
        group_stats["b"]["arpu"],
        group_stats["b"]["variance"],
        group_stats["b"]["users"],
    )
    pay_rate_test["relative_uplift_pct"] = round_num(
        percent(pay_rate_test["difference_pct_points"], group_stats["a"]["pay_rate"]),
        4,
    ) if group_stats["a"]["pay_rate"] else 0.0
    arpu_test["relative_uplift_pct"] = round_num(
        percent(arpu_test["difference"], group_stats["a"]["arpu"]),
        4,
    ) if group_stats["a"]["arpu"] else 0.0

    return {
        "meta": {
            "sample_users": total_users,
            "metric_scope": "ab_test_sample_only",
        },
        "summary": {
            "sample_users": total_users,
            "sample_payers": total_payers,
            "sample_pay_rate": round_num(percent(total_payers, total_users), 4),
            "sample_arpu": round_num(total_revenue / total_users, 4) if total_users else 0.0,
            "sample_arppu": round_num(total_revenue / total_payers, 4) if total_payers else 0.0,
            "sample_total_revenue": round_num(total_revenue, 2),
        },
        "tiers": tier_rows,
        "groups": group_rows,
        "tests": {
            "pay_rate": pay_rate_test,
            "arpu": arpu_test,
        },
    }


def build_dashboard_payload(
    reg: pd.DataFrame,
    auth: pd.DataFrame,
    daily_metrics: pd.DataFrame,
    overall_retention: pd.DataFrame,
    cohort_retention: pd.DataFrame,
    activity_segments: pd.DataFrame,
    ab_summary: dict[str, object],
) -> dict[str, object]:
    latest_7d_avg_dau = round_num(daily_metrics["dau"].tail(7).mean(), 2)

    retention_lookup = overall_retention.set_index("day")["retention_rate"].to_dict()
    overview_kpis = {
        "total_registered_users": int(reg["uid"].nunique()),
        "latest_7d_avg_dau": latest_7d_avg_dau,
        "d1_retention": round_num(retention_lookup[1], 4),
        "d3_retention": round_num(retention_lookup[3], 4),
        "d7_retention": round_num(retention_lookup[7], 4),
        "d14_retention": round_num(retention_lookup[14], 4),
        "d30_retention": round_num(retention_lookup[30], 4),
        "ab_sample_users": int(ab_summary["summary"]["sample_users"]),
        "ab_pay_rate": round_num(ab_summary["summary"]["sample_pay_rate"], 4),
        "ab_arpu": round_num(ab_summary["summary"]["sample_arpu"], 4),
        "ab_arppu": round_num(ab_summary["summary"]["sample_arppu"], 4),
        "ab_total_revenue": round_num(ab_summary["summary"]["sample_total_revenue"], 2),
    }

    return {
        "meta": {
            "generated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "timezone": TIMEZONE,
            "data_range": {
                "reg_start": reg["reg_date"].min().strftime("%Y-%m-%d"),
                "reg_end": reg["reg_date"].max().strftime("%Y-%m-%d"),
                "auth_start": auth["auth_date"].min().strftime("%Y-%m-%d"),
                "auth_end": auth["auth_date"].max().strftime("%Y-%m-%d"),
                "ab_start": None,
                "ab_end": None,
            },
            "source_rows": {
                "reg": int(len(reg)),
                "auth": int(len(auth)),
                "ab_test": int(ab_summary["meta"]["sample_users"]),
            },
            "source_users": {
                "reg": int(reg["uid"].nunique()),
                "auth": int(auth["uid"].nunique()),
                "ab_test": int(ab_summary["meta"]["sample_users"]),
            },
        },
        "overview": {
            "kpis": overview_kpis,
        },
        "trends": {
            "daily": daily_metrics.to_dict("records"),
        },
        "retention": {
            "overall": overall_retention.to_dict("records"),
            "cohorts": cohort_retention.to_dict("records"),
        },
        "activity_segments": {
            "window_days": ACTIVITY_WINDOW_DAYS,
            "as_of_date": activity_segments["as_of_date"].iloc[0],
            "segments": activity_segments[["segment", "users", "share"]].to_dict("records"),
        },
        "ab_test": ab_summary,
    }


def build_legacy_dashboard_metrics(
    reg: pd.DataFrame,
    auth: pd.DataFrame,
    daily_metrics: pd.DataFrame,
    overall_retention: pd.DataFrame,
    cohort_retention: pd.DataFrame,
    activity_segments: pd.DataFrame,
    ab_summary: dict[str, object],
) -> dict[str, object]:
    weekly_dau = build_weekly_series(daily_metrics)
    retention_full = [
        {"d": f"D{int(row.day)}", "v": round_num(row.retention_rate, 4)}
        for row in overall_retention.itertuples(index=False)
    ]
    retention_lookup = {
        f"D{int(row.day)}": round_num(row.retention_rate, 4)
        for row in overall_retention.itertuples(index=False)
    }
    cohort_rows = []
    cohort_subset = cohort_retention[cohort_retention["cohort_label"].isin(LEGACY_COHORT_MONTHS)]
    for row in cohort_subset.itertuples(index=False):
        cohort_rows.append(
            {
                "month": row.cohort_label,
                "m": f"{int(row.cohort_label[-2:])}月",
                "D1": round_num(row.d1_retention, 4),
                "D3": round_num(row.d3_retention, 4),
                "D7": round_num(row.d7_retention, 4),
                "D14": round_num(row.d14_retention, 4),
                "D30": round_num(row.d30_retention, 4),
            }
        )

    group_lookup = {group["group"]: group for group in ab_summary["groups"]}
    segment_label_map = {
        "inactive_30d": "近30日未登录",
        "light_1_3d": "轻度活跃 (1-3天)",
        "mid_4_9d": "中度活跃 (4-9天)",
        "core_10p_d": "核心活跃 (10天+)",
    }
    activity_segment_rows = []
    for row in activity_segments.itertuples(index=False):
        activity_segment_rows.append(
            {
                "key": row.segment,
                "label": segment_label_map[row.segment],
                "count": int(row.users),
                "share": round_num(row.share, 4),
            }
        )

    return {
        "meta": {
            "generated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "timezone": TIMEZONE,
            "data_start": auth["auth_date"].min().date().isoformat(),
            "data_end": auth["auth_date"].max().date().isoformat(),
            "reg_rows": int(len(reg)),
            "reg_users": int(reg["uid"].nunique()),
            "auth_rows": int(len(auth)),
            "auth_users": int(auth["uid"].nunique()),
            "ab_rows": int(ab_summary["summary"]["sample_users"]),
            "ab_users": int(ab_summary["summary"]["sample_users"]),
        },
        "overview": {
            "dau_7d_avg": round_num(daily_metrics["dau"].tail(7).mean(), 2),
            "dau_growth_pct": round_num(percent(weekly_dau[-1]["v"] - weekly_dau[0]["v"], weekly_dau[0]["v"]), 4),
            "retention": {
                key: retention_lookup[key]
                for key in ["D1", "D3", "D7", "D14", "D30"]
            },
            "monetization": {
                "users": int(ab_summary["summary"]["sample_users"]),
                "payers": int(ab_summary["summary"]["sample_payers"]),
                "pay_rate": round_num(ab_summary["summary"]["sample_pay_rate"], 4),
                "total_revenue": round_num(ab_summary["summary"]["sample_total_revenue"], 2),
                "arpu": round_num(ab_summary["summary"]["sample_arpu"], 4),
                "arppu": round_num(ab_summary["summary"]["sample_arppu"], 4),
            },
        },
        "charts": {
            "dau_weekly": weekly_dau,
            "retention_full": retention_full,
            "retention_overview": [{"d": "D0", "v": 100.0}, *retention_full],
            "cohort": cohort_rows,
        },
        "revenue": {
            "scope": "ab_test_sample",
            "overall": {
                "users": int(ab_summary["summary"]["sample_users"]),
                "payers": int(ab_summary["summary"]["sample_payers"]),
                "pay_rate": round_num(ab_summary["summary"]["sample_pay_rate"], 4),
                "total_revenue": round_num(ab_summary["summary"]["sample_total_revenue"], 2),
                "arpu": round_num(ab_summary["summary"]["sample_arpu"], 4),
                "arppu": round_num(ab_summary["summary"]["sample_arppu"], 4),
            },
            "tiers": ab_summary["tiers"],
        },
        "ab_test": {
            "groups": {
                key: {
                    "users": value["users"],
                    "payers": value["payers"],
                    "pay_rate": value["pay_rate"],
                    "arpu": value["arpu"],
                    "arppu": value["arppu"],
                }
                for key, value in group_lookup.items()
            },
            "tests": ab_summary["tests"],
        },
        "activity_segments": {
            "window_start": (pd.to_datetime(activity_segments["as_of_date"].iloc[0]) - pd.Timedelta(days=29)).date().isoformat(),
            "window_end": activity_segments["as_of_date"].iloc[0],
            "segments": activity_segment_rows,
        },
    }


def main() -> None:
    reg, auth, ab = load_sources()
    auth_user_day = auth[["uid", "auth_date"]].drop_duplicates()

    daily_metrics = build_daily_metrics(reg, auth_user_day)
    overall_retention, cohort_retention = build_retention_tables(reg, auth_user_day)
    activity_segments = build_activity_segments(reg, auth_user_day)
    ab_summary = build_ab_summary(ab)
    dashboard_payload = build_dashboard_payload(
        reg,
        auth,
        daily_metrics,
        overall_retention,
        cohort_retention,
        activity_segments,
        ab_summary,
    )
    legacy_dashboard_metrics = build_legacy_dashboard_metrics(
        reg,
        auth,
        daily_metrics,
        overall_retention,
        cohort_retention,
        activity_segments,
        ab_summary,
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    daily_metrics.to_csv(OUTPUT_DIR / "daily_metrics.csv", index=False)
    cohort_retention.to_csv(OUTPUT_DIR / "cohort_retention.csv", index=False)
    activity_segments.to_csv(OUTPUT_DIR / "activity_segments.csv", index=False)
    write_json(OUTPUT_DIR / "ab_test_summary.json", ab_summary)
    write_json(OUTPUT_DIR / "dashboard_payload.json", dashboard_payload)
    write_json(LEGACY_OUTPUT_FILE, legacy_dashboard_metrics)

    print(f"Wrote {OUTPUT_DIR / 'dashboard_payload.json'}")
    print(f"Wrote {OUTPUT_DIR / 'daily_metrics.csv'}")
    print(f"Wrote {OUTPUT_DIR / 'cohort_retention.csv'}")
    print(f"Wrote {OUTPUT_DIR / 'activity_segments.csv'}")
    print(f"Wrote {OUTPUT_DIR / 'ab_test_summary.json'}")
    print(f"Wrote {LEGACY_OUTPUT_FILE}")


if __name__ == "__main__":
    main()
