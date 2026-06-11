"""The §10 pre-deploy verification (Initial_plan.md): run ONCE with a real
WANDB_API_KEY before trusting render_report.py, because the two
version-sensitive strings — the literal config-key path and the filter
form — are the most likely failure mode of the Public Preview API.

Usage (from the repo root, .env filled in):
    python sidecar/smoke_test.py            # step 1 only: inspect live config keys
    python sidecar/smoke_test.py --save     # also create one trivial draft report

Step 1 pulls one run from WANDB_SOURCE_PROJECT and prints the live config keys
next to the spec form the site derives from the frozen CSV. If they disagree
(e.g. live runs use `axes/attention_biases` while the CSV was exported with
renamed columns like `axes/B1_Bias Activation Set`), the resolution in
backend/src/tools/author-report.tool.ts must be remapped BEFORE Phase 2 goes
live — that is exactly what this script exists to catch.

Step 2 (--save) pipes a minimal spec through render_report.py's own code path
and saves a draft report titled "[smoke test] …" to WANDB_TARGET_PROJECT.
Verify in the W&B UI that it is a DRAFT and the panel renders, then delete it.
"""

import argparse
import json
import os
import sys

# Reuse the real renderer so the smoke test exercises the production code path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_report  # noqa: E402

AXIS_FILTER_KEY = "config:axes/H10_Model Size Label.value"
AXIS_FILTER_VALUE = "d256_L6"
GROUPBY_KEY = "config:axes/B1_Bias Activation Set.value"
METRIC = "eval_v2/test_auroc"


def load_env() -> dict:
    # Minimal .env reader so the script works without python-dotenv.
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())
    cfg = {
        "entity": os.environ.get("WANDB_ENTITY", ""),
        "source": os.environ.get("WANDB_SOURCE_PROJECT", ""),
        "target": os.environ.get("WANDB_TARGET_PROJECT", "thesis-visitor-reports"),
    }
    missing = [k for k, v in cfg.items() if not v]
    if missing or not os.environ.get("WANDB_API_KEY"):
        sys.exit(f"Set WANDB_API_KEY / WANDB_ENTITY / WANDB_SOURCE_PROJECT in .env first (missing: {missing}).")
    return cfg


def step1_inspect_live_keys(cfg: dict) -> None:
    import wandb

    api = wandb.Api()
    runs = api.runs(f"{cfg['entity']}/{cfg['source']}", per_page=1)
    run = next(iter(runs), None)
    if run is None:
        sys.exit(f"No runs found in {cfg['entity']}/{cfg['source']}.")

    print(f"== Step 1: live config keys of run {run.id} ({run.name}) ==")
    axes_keys = sorted(k for k in run.config.keys() if "axes" in k.lower())
    for k in axes_keys or sorted(run.config.keys())[:40]:
        print(f"  live config key: {k!r}")

    expected = render_report.config_path(AXIS_FILTER_KEY)
    print(f"\n  spec form the site will send:  Config({expected!r})")
    if any(k == expected or k.startswith(expected.split('/')[0]) for k in axes_keys):
        print("  -> a matching live key family exists; eyeball the exact strings above.")
    else:
        print(
            "  !! NO matching live key — the frozen CSV columns were renamed during "
            "export. Remap the field resolution in author-report.tool.ts before "
            "enabling Phase 2."
        )


def step2_save_draft(cfg: dict) -> None:
    spec = {
        "title": "[smoke test] median test AUROC by B1 — delete me",
        "description": "Created by sidecar/smoke_test.py (Initial_plan.md §10). Safe to delete.",
        "entity": cfg["entity"],
        "source_project": cfg["source"],
        "target_project": cfg["target"],
        "runset": {
            "filters": [{"field": AXIS_FILTER_KEY, "op": "==", "value": AXIS_FILTER_VALUE}],
            "groupby": [GROUPBY_KEY],
        },
        "blocks": [
            {"type": "prose", "text": "Single scalar panel, median across seeds, baseline runs only."},
            {
                "type": "panel",
                "kind": "scalar_by_axis",
                "title": "median test AUROC by B1",
                "metric": METRIC,
                "groupby": GROUPBY_KEY,
                "agg": "median",
            },
        ],
    }

    print("\n== Step 2: saving one trivial DRAFT report through render_report.py ==")
    import wandb_workspaces.reports.v2 as wr
    from wandb_workspaces import expr

    blocks = [
        wr.P(spec["blocks"][0]["text"]),
        render_report.build_panel_grid(wr, expr, spec, spec["blocks"][1]),
    ]
    report = wr.Report(
        entity=spec["entity"],
        project=spec["target_project"],
        title=spec["title"],
        description=spec["description"],
        blocks=blocks,
    )
    report.save(draft=True)
    print(json.dumps({"ok": True, "url": report.url}))
    print("Open the URL: confirm it is a DRAFT, the runset filter matched runs, and the panel renders.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", action="store_true", help="also create one trivial draft report")
    args = parser.parse_args()

    cfg = load_env()
    step1_inspect_live_keys(cfg)
    if args.save:
        step2_save_draft(cfg)
    else:
        print("\nRe-run with --save to create the trivial draft report (step 2).")
