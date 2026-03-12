// ═══════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
  });
});

// ═══════════════════════════════════════════════════
// CHART.JS GLOBAL DEFAULTS
// ═══════════════════════════════════════════════════
Chart.defaults.color = '#71717A';
Chart.defaults.borderColor = '#E4E4E7';
Chart.defaults.font.family = "'Inter', -apple-system, 'PingFang SC', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.legend.display = false;
Chart.defaults.plugins.tooltip.backgroundColor = '#FFFFFF';
Chart.defaults.plugins.tooltip.titleColor = '#18181B';
Chart.defaults.plugins.tooltip.bodyColor = '#71717A';
Chart.defaults.plugins.tooltip.borderColor = '#E4E4E7';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.cornerRadius = 10;
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.titleFont = { weight: '600', size: 12 };
Chart.defaults.plugins.tooltip.bodyFont = { size: 13, weight: '500' };
Chart.defaults.plugins.tooltip.displayColors = false;
Chart.defaults.plugins.tooltip.boxShadow = '0 4px 16px rgba(0,0,0,0.08)';

const numberFormatter = new Intl.NumberFormat('zh-CN');

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value, digits = 2) {
  return `${formatNumber(value, digits)}%`;
}

function formatCurrency(value, digits = 2) {
  if (!value) {
    return '$0';
  }
  return `$${formatNumber(value, digits)}`;
}

function formatCompactCurrency(value) {
  if (!value) {
    return '$0';
  }

  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  }
  if (absolute >= 1_000) {
    return `$${(value / 1_000).toFixed(2).replace(/\.00$/, '')}K`;
  }
  return formatCurrency(value);
}

function makeGradient(ctx, color, alpha1 = 0.25, alpha2 = 0) {
  const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  gradient.addColorStop(0, color.replace(')', `,${alpha1})`).replace('rgb', 'rgba'));
  gradient.addColorStop(1, color.replace(')', `,${alpha2})`).replace('rgb', 'rgba'));
  return gradient;
}

function getPeakRetentionPoint(retentionFull, startDay, endDay) {
  const range = retentionFull.filter(point => {
    const day = Number(point.d.replace('D', ''));
    return day >= startDay && day <= endDay;
  });
  return range.reduce((best, point) => (point.v > best.v ? point : best), range[0]);
}

// Lightweight insight helpers:
// use a few fixed thresholds to turn existing metrics into operator-facing notes,
// without pretending to be an automated decision engine.
function getSegmentByKey(activitySegments, key) {
  return activitySegments.find(segment => segment.key === key);
}

function renderOverview(data) {
  const { overview, meta, activity_segments: activity } = data;
  const inactive = getSegmentByKey(activity.segments, 'inactive_30d');
  const mid = getSegmentByKey(activity.segments, 'mid_4_9d');
  const operatorNote = [];

  if (overview.retention.D1 < 5) {
    operatorNote.push(`首日承接偏弱，D1 仅 ${formatPercent(overview.retention.D1)}`);
  } else {
    operatorNote.push(`首日承接暂时稳定，D1 为 ${formatPercent(overview.retention.D1)}`);
  }

  if (inactive.share >= 80) {
    operatorNote.push(`近30日沉默用户占 ${formatPercent(inactive.share)}，召回池较大`);
  }

  if (mid.share > 5) {
    operatorNote.push(`4-9 天游玩用户占 ${formatPercent(mid.share)}，存在向核心活跃深化的空间`);
  }

  setText('overviewDauValue', formatNumber(overview.dau_7d_avg, 0));
  setText('overviewD1Value', formatPercent(overview.retention.D1));
  setText('overviewD7Value', formatPercent(overview.retention.D7));
  setText('overviewPayRateValue', formatPercent(overview.monetization.pay_rate));
  setText('overviewArpuValue', formatCurrency(overview.monetization.arpu));
  setText('overviewArppuValue', formatCompactCurrency(overview.monetization.arppu));
  setText(
    'overviewPayRateSub',
    `${formatNumber(overview.monetization.payers)} / ${formatNumber(overview.monetization.users)} A/B 实验样本付费用户`
  );
  setText(
    'overviewDataNote',
    `数据来源：reg_data.csv、auth_data.csv、ab_test.csv。页面读取离线聚合后的 dashboard-metrics.json，不直接加载原始大文件；当前展示覆盖全量注册 ${formatNumber(meta.reg_users)}、登录事件 ${formatNumber(meta.auth_rows)}，截至 ${meta.data_end}。`
  );
  setText(
    'overviewOperatorNote',
    `运营快照：${operatorNote.join('；')}。当前更适合把重点放在首日承接修复与中层活跃深化，而不是只看表面 DAU 增长。`
  );
}

function renderRetention(data) {
  const { overview, charts, meta } = data;
  const peak = getPeakRetentionPoint(charts.retention_full, 2, 7);

  setText('retentionD1Value', formatPercent(overview.retention.D1));
  setText('retentionD3Value', formatPercent(overview.retention.D3));
  setText('retentionD7Value', formatPercent(overview.retention.D7));
  setText('retentionD14Value', formatPercent(overview.retention.D14));
  setText('retentionD30Value', formatPercent(overview.retention.D30));
  setText(
    'retentionSummary',
    `口径说明：留存按注册 cohort 计算定点留存，Dn 表示用户是否在注册后第 n 个自然日登录，不是滚动留存，因此曲线不一定单调下降。当前截至 ${meta.data_end}，未成熟窗口按可观测用户计算；样本中 ${peak.d} 回升至 ${formatPercent(peak.v)}，更适合作为首周回流信号。运营上应优先修复 D1，并复核签到、任务或活动节奏是否在 ${peak.d} 附近形成固定回访节点。`
  );
  setText(
    'cohortNote',
    '热力图仅展示 2020 注册 cohort，便于对比近期稳定样本；更早月份存在较多样本极小的稀疏 cohort，因此不放在页面主展示区域。'
  );

  const tbody = document.querySelector('#cohortTable tbody');
  const keys = ['D1', 'D3', 'D7', 'D14', 'D30'];
  const maxValues = keys.reduce((accumulator, key) => {
    accumulator[key] = Math.max(...charts.cohort.map(row => row[key]));
    return accumulator;
  }, {});

  tbody.innerHTML = '';
  charts.cohort.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="font-family:var(--font-sans);font-weight:600;color:var(--text-main)">${row.m}</td>`;
    keys.forEach(key => {
      const value = row[key];
      const intensity = maxValues[key] ? Math.min(value / maxValues[key], 1) : 0;
      const alpha = (intensity * 0.55).toFixed(2);
      const color = intensity > 0.6 ? '#FFFFFF' : '#18181B';
      tr.innerHTML += `<td class="heat-cell" style="background:rgba(5,150,105,${alpha});color:${color}">${formatPercent(value)}</td>`;
    });
    tbody.appendChild(tr);
  });
}

function renderRevenue(data) {
  const { revenue } = data;
  const overall = revenue.overall;
  const superTier = revenue.tiers.find(tier => tier.key === 'super');
  const tableBody = document.getElementById('revenueTierTableBody');

  setText('revenueTotalValue', formatCompactCurrency(overall.total_revenue));
  setText('revenuePayRateValue', formatPercent(overall.pay_rate));
  setText('revenueArpuValue', formatCurrency(overall.arpu));
  setText('revenueArppuValue', formatCompactCurrency(overall.arppu));
  setText(
    'revenuePayRateSub',
    `${formatNumber(overall.payers)} / ${formatNumber(overall.users)} A/B 实验样本付费用户`
  );
  setText(
    'revenueInsight',
    `以下营收结构仅代表 ab_test 样本：其中仅 ${formatPercent(superTier.user_share)} 的超级鲸鱼贡献了 ${formatPercent(superTier.revenue_share)} 营收（${formatCompactCurrency(superTier.revenue)}）。当前更像“低转化、高客单、强集中”结构，运营上更值得先补首购路径和中腰部商品，而不是继续放大少数高价值用户贡献。`
  );

  tableBody.innerHTML = '';
  revenue.tiers.forEach(tier => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="tier-dot" style="background:${tier.color}"></span>${tier.label}</td>
      <td>${formatNumber(tier.user_count)}</td>
      <td>${formatPercent(tier.user_share)}</td>
      <td>${formatCompactCurrency(tier.revenue)}</td>
      <td>${formatPercent(tier.revenue_share)}</td>
      <td>${tier.arppu ? formatCurrency(tier.arppu) : '-'}</td>
    `;
    tableBody.appendChild(tr);
  });
}

function renderAbTest(data) {
  const { ab_test: abTest } = data;
  const groupA = abTest.groups.a;
  const groupB = abTest.groups.b;
  const payRateTest = abTest.tests.pay_rate;
  const arpuTest = abTest.tests.arpu;

  setText('abAUsers', formatNumber(groupA.users));
  setText('abAPayRate', formatPercent(groupA.pay_rate));
  setText('abAArpu', formatCurrency(groupA.arpu));
  setText('abBUsers', formatNumber(groupB.users));
  setText('abBPayRate', formatPercent(groupB.pay_rate));
  setText('abBArpu', formatCurrency(groupB.arpu));
  setText(
    'abTestNote',
    '说明：本模块仅基于 ab_test.csv 样本。这里的付费率=样本内付费用户占比，ARPU=样本内总收入/总用户；数据未提供实验起止时间、分流规则与曝光口径，因此这里只做样本结果解读，更适合回答“是否值得继续验证”，而不是直接决定上线。'
  );

  setText(
    'abInsight',
    `A/B 结果仅基于 ab_test 样本。B 组 ARPU 比 A 组高 ${formatCurrency(arpuTest.difference)}（${formatPercent(arpuTest.relative_uplift_pct)}），但 p=${arpuTest.p_value.toFixed(3)}；付费率反而低 ${formatNumber(Math.abs(payRateTest.difference_pct_points), 2)}pct（p=${payRateTest.p_value.toFixed(3)}）。当前更适合把它视为“存在收入趋势、但伴随转化风险”的样本信号，运营上不建议直接推广，更适合继续观察或补实验信息。`
  );
}

function renderInsights(data) {
  const { overview, charts, revenue, ab_test: abTest, activity_segments: activity, meta } = data;
  const peak = getPeakRetentionPoint(charts.retention_full, 2, 7);
  const superTier = revenue.tiers.find(tier => tier.key === 'super');
  const weeklyStart = charts.dau_weekly[0];
  const weeklyEnd = charts.dau_weekly[charts.dau_weekly.length - 1];
  const payRateTest = abTest.tests.pay_rate;
  const arpuTest = abTest.tests.arpu;
  const inactive = activity.segments.find(segment => segment.key === 'inactive_30d');
  const core = activity.segments.find(segment => segment.key === 'core_10p_d');

  setText(
    'insightMethodNote',
    '本页区分“数据结论”和“运营假设”：数字来自离线聚合结果，行动建议属于基于当前数据提出的候选方向，仍需结合版本、活动、渠道与实验条件继续验证。'
  );

  setText(
    'insightRetentionDrop',
    `紧急：次日留存仅 ${formatPercent(overview.retention.D1)}。也就是有 ${(100 - overview.retention.D1).toFixed(2)}% 的新用户没有在次日回来，首日体验仍是最优先的流失修复点。对运营而言，这通常先看新手引导完成、首日奖励承接和次日触达是否足够。`
  );
  setText(
    'insightRetentionRebound',
    `异常模式：${peak.d} 定点留存回升到 ${formatPercent(peak.v)}。这更适合被视为运营假设信号，可能与首周任务、签到或活动节奏有关，仍需结合版本与活动排期验证。`
  );
  setText(
    'insightRevenue',
    `实验样本中的收入结构高度集中：${formatNumber(superTier.user_count)} 名超级鲸鱼仅占 ${formatPercent(superTier.user_share)}，却贡献了 ${formatPercent(superTier.revenue_share)} 营收。这提示变现对高价值用户依赖较强；更务实的运营方向是补中腰部商品和首付转化，而不是只围绕鲸鱼做活动。`
  );
  setText(
    'insightDau',
    `DAU 仍在增长：2020 年首周周均 DAU 为 ${formatNumber(weeklyStart.v, 0)}，最新周均值已到 ${formatNumber(weeklyEnd.v, 0)}，涨幅 ${formatPercent(overview.dau_growth_pct)}。但如果留存不修复，这种增长更像持续拉新驱动；对运营来说，复盘新增质量会比单纯追 DAU 更重要。`
  );
  setText(
    'insightAb',
    `A/B 样本内尚未显示 B 组更优：B 组付费率比 A 组低 ${formatNumber(Math.abs(payRateTest.difference_pct_points), 2)}pct，且在 5% 水平达到显著性（p=${payRateTest.p_value.toFixed(3)}）；ARPU 虽高 ${formatCurrency(arpuTest.difference)}，但并不显著（p=${arpuTest.p_value.toFixed(3)}）。作为运营判断，更应优先警惕转化下滑，而不是只盯收入抬升趋势。`
  );
  setText(
    'insightSegments',
    `活跃分层偏轻：截至 ${meta.data_end}，近30日未登录占 ${formatPercent(inactive.share)}，核心活跃（10天+）仅 ${formatPercent(core.share)}。更值得运营跟进的是 1-9 天游玩用户的活跃深化与轻召回，因为这部分人比 30 日沉默用户更容易被重新拉活。`
  );
}

function renderFooter(data) {
  const { meta } = data;
  setText(
    'footerScope',
    `游戏运营数据看板 · 数据源 reg/auth/ab_test · 页面读取离线聚合结果 · 全量注册 ${formatNumber(meta.reg_users)} · 登录事件 ${formatNumber(meta.auth_rows)} · 变现/A/B 为实验样本口径 ${formatNumber(meta.ab_users)}`
  );
}

function buildCharts(data) {
  const { charts, revenue, ab_test: abTest } = data;
  const dauValues = charts.dau_weekly.map(point => point.v);
  const retentionValues = charts.retention_full.map(point => point.v);
  const cohortValues = charts.cohort.map(point => point.D7);
  const dauMin = Math.floor(Math.min(...dauValues) * 0.95 / 500) * 500;
  const retentionMax = Math.ceil(Math.max(...retentionValues) + 1);
  const cohortMax = Math.ceil(Math.max(...cohortValues) + 1);
  const paidUsers = revenue.overall.users - revenue.tiers.find(tier => tier.key === 'free').user_count;
  const superTier = revenue.tiers.find(tier => tier.key === 'super');
  const midTier = revenue.tiers.find(tier => tier.key === 'mid');

  const ctxDAU = document.getElementById('chartDAU').getContext('2d');
  new Chart(ctxDAU, {
    type: 'line',
    data: {
      labels: charts.dau_weekly.map(point => point.d),
      datasets: [{
        label: '日活',
        data: dauValues,
        borderColor: '#059669',
        backgroundColor: makeGradient(ctxDAU, 'rgb(5,150,105)', 0.14, 0),
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#059669',
        pointHoverBorderColor: '#FFFFFF',
        pointHoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { size: 11 }, color: '#71717A' } },
        y: {
          min: dauMin,
          grid: { color: '#E4E4E7' },
          ticks: {
            font: { size: 11 },
            color: '#71717A',
            callback: value => formatNumber(value, 0),
          },
        },
      },
      plugins: {
        tooltip: {
          callbacks: { label: ctx => `DAU: ${formatNumber(ctx.parsed.y, 0)}` }
        }
      }
    }
  });

  const ctxRetOverview = document.getElementById('chartRetOverview').getContext('2d');
  new Chart(ctxRetOverview, {
    type: 'line',
    data: {
      labels: charts.retention_overview.map(point => point.d),
      datasets: [{
        label: '留存率',
        data: charts.retention_overview.map(point => point.v),
        borderColor: '#F59E0B',
        backgroundColor: makeGradient(ctxRetOverview, 'rgb(245,158,11)', 0.12, 0),
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#F59E0B',
        pointHoverBorderColor: '#FFFFFF',
        pointHoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 10 }, color: '#71717A' } },
        y: {
          grid: { color: '#E4E4E7' },
          ticks: { callback: value => `${value}%`, font: { size: 11 }, color: '#71717A' }
        }
      },
      plugins: {
        tooltip: { callbacks: { label: ctx => `留存率: ${formatPercent(ctx.parsed.y)}` } }
      }
    }
  });

  const ctxRetFull = document.getElementById('chartRetFull').getContext('2d');
  new Chart(ctxRetFull, {
    type: 'line',
    data: {
      labels: charts.retention_full.map(point => point.d),
      datasets: [{
        label: '留存率',
        data: retentionValues,
        borderColor: '#F59E0B',
        backgroundColor: makeGradient(ctxRetFull, 'rgb(245,158,11)', 0.14, 0),
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: '#F59E0B',
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#71717A' } },
        y: {
          min: 0,
          max: retentionMax,
          grid: { color: '#E4E4E7' },
          ticks: { callback: value => `${value}%`, font: { size: 11 }, color: '#71717A' }
        }
      },
      plugins: {
        tooltip: { callbacks: { label: ctx => `留存率: ${formatPercent(ctx.parsed.y)}` } }
      }
    }
  });

  new Chart(document.getElementById('chartCohortD7'), {
    type: 'bar',
    data: {
      labels: charts.cohort.map(point => point.m),
      datasets: [{
        label: '7日留存',
        data: cohortValues,
        backgroundColor: 'rgba(5,150,105,0.18)',
        hoverBackgroundColor: 'rgba(5,150,105,0.75)',
        borderColor: '#059669',
        borderWidth: 1.5,
        borderRadius: 7,
        borderSkipped: false,
        barPercentage: 0.6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 12 }, color: '#71717A' } },
        y: {
          min: 0,
          max: cohortMax,
          grid: { color: '#E4E4E7' },
          ticks: { callback: value => `${value}%`, font: { size: 11 }, color: '#71717A' }
        }
      },
      plugins: {
        tooltip: { callbacks: { label: ctx => `7日留存: ${formatPercent(ctx.parsed.y)}` } }
      }
    }
  });

  new Chart(document.getElementById('chartRevPie'), {
    type: 'doughnut',
    data: {
      labels: [
        `${superTier.label} (${formatPercent(superTier.revenue_share)})`,
        `${midTier.label} (${formatPercent(midTier.revenue_share)})`,
      ],
      datasets: [{
        data: [superTier.revenue_share, midTier.revenue_share],
        backgroundColor: [superTier.color, midTier.color],
        hoverBackgroundColor: ['#047857', '#D97706'],
        borderWidth: 0,
        spacing: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            padding: 16,
            usePointStyle: true,
            pointStyle: 'circle',
            font: { size: 12 },
            color: '#71717A',
          }
        },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatPercent(ctx.parsed)}` } }
      }
    }
  });

  new Chart(document.getElementById('chartUserPie'), {
    type: 'doughnut',
    data: {
      labels: [
        `免费用户 (${formatPercent(revenue.tiers.find(tier => tier.key === 'free').user_share)})`,
        `付费用户 (${formatPercent(revenue.overall.pay_rate)})`,
      ],
      datasets: [{
        data: [revenue.tiers.find(tier => tier.key === 'free').user_count, paidUsers],
        backgroundColor: ['#E4E4E7', '#059669'],
        hoverBackgroundColor: ['#D4D4D8', '#047857'],
        borderWidth: 0,
        spacing: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            padding: 16,
            usePointStyle: true,
            pointStyle: 'circle',
            font: { size: 12 },
            color: '#71717A',
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${formatNumber(ctx.parsed, 0)} 用户`
          }
        }
      }
    }
  });

  new Chart(document.getElementById('chartAB'), {
    type: 'bar',
    data: {
      labels: ['付费率 (%)', 'ARPU ($)'],
      datasets: [
        {
          label: '对照组 (A)',
          data: [abTest.groups.a.pay_rate, abTest.groups.a.arpu],
          backgroundColor: 'rgba(5,150,105,0.18)',
          hoverBackgroundColor: 'rgba(5,150,105,0.75)',
          borderColor: '#059669',
          borderWidth: 1.5,
          borderRadius: 6,
          barPercentage: 0.5,
        },
        {
          label: '实验组 (B)',
          data: [abTest.groups.b.pay_rate, abTest.groups.b.arpu],
          backgroundColor: 'rgba(16,185,129,0.18)',
          hoverBackgroundColor: 'rgba(16,185,129,0.75)',
          borderColor: '#10B981',
          borderWidth: 1.5,
          borderRadius: 6,
          barPercentage: 0.5,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: {
          grid: { color: '#E4E4E7' },
          ticks: { font: { size: 11 }, color: '#71717A' }
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 12, weight: '600' }, color: '#71717A' }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            padding: 20,
            usePointStyle: true,
            pointStyle: 'circle',
            font: { size: 12 },
            color: '#71717A',
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const isPayRate = ctx.label.includes('付费率');
              const value = isPayRate ? formatPercent(ctx.parsed.x) : formatCurrency(ctx.parsed.x);
              return `${ctx.dataset.label}: ${value}`;
            }
          }
        }
      }
    }
  });
}

function showLoadError(error) {
  console.error(error);
  const primaryMessage = '数据加载失败，请通过本地 HTTP 服务访问页面，并确认 data/dashboard-metrics.json 可读。';
  const secondaryMessage = '当前无法显示说明与结论。';
  const detailMessage = '请先恢复数据加载。';

  setText('overviewDataNote', primaryMessage);
  setText('footerScope', '数据加载失败：请检查本地 HTTP 服务与聚合结果文件。');
  [
    'overviewOperatorNote',
    'retentionSummary',
    'cohortNote',
    'revenueInsight',
    'abTestNote',
    'abInsight',
    'insightMethodNote',
  ].forEach(id => setText(id, secondaryMessage));
  [
    'insightRetentionDrop',
    'insightRetentionRebound',
    'insightRevenue',
    'insightDau',
    'insightAb',
    'insightSegments',
  ].forEach(id => setText(id, detailMessage));
}

async function loadDashboard() {
  const response = await fetch('data/dashboard-metrics.json');
  if (!response.ok) {
    throw new Error(`Failed to load dashboard data: ${response.status}`);
  }

  const data = await response.json();
  renderOverview(data);
  renderRetention(data);
  renderRevenue(data);
  renderAbTest(data);
  renderInsights(data);
  renderFooter(data);
  buildCharts(data);
}

loadDashboard().catch(showLoadError);
