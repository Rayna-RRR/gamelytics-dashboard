# AGENTS.md

## Project role
This repository is a portfolio project for mainland China game-industry job applications.

## Target role
Game operations (data-oriented), for small and mid-sized game studios, especially smaller teams.

## Project goal
Upgrade an existing game analytics dashboard from a sample-data demo into a full-data, credible portfolio project.

## Highest-priority constraints
1. Do NOT redesign the UI.
2. Do NOT replace the current visual style.
3. Do NOT introduce a heavy framework.
4. Preserve the current HTML/CSS/JS structure whenever possible.
5. Use minimal, surgical edits.
6. Prefer credibility and data correctness over flashy features.

## Data context
The dashboard should be updated to use full data from:
- reg_data.csv
- auth_data.csv
- ab_test.csv

Do not load raw large CSV files directly in the browser.
Use an offline aggregation pipeline and let the front end read processed JSON/CSV outputs.

## Product priorities
1. Correct metric definitions
2. Full-data aggregation
3. Cohort retention
4. Activity segmentation
5. A/B test credibility
6. Minimal UI changes
7. Portfolio-ready documentation

## Workflow
Before changing files:
- inspect the repo
- explain the current structure
- propose the smallest safe change set

After changing files:
- list modified files
- explain why each was changed
- explain how to test locally
- explain what was intentionally left untouched

## Non-goals
- No full redesign
- No React/Vue migration
- No "SaaS dashboard" visual overhaul
- No unnecessary animation or styling experiments