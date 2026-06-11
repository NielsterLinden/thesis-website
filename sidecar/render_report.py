"""Render a semantic report spec into a DRAFT W&B report (Initial_plan.md §6).

Contract: the validated JSON spec arrives on stdin; exactly one JSON object
leaves on the LAST stdout line — {"ok": true, "url": "…"} or
{"ok": false, "error": "…"}. The Nest /reports/save endpoint is the only
caller; the model never invokes this script.

This is the ONLY file that knows wandb-workspaces exists. When the Public
Preview API shifts, patch here — the spec schema and everything above it stay
untouched.

Safety invariants enforced again here (defense in depth behind schema.ts):
  - the report is saved with draft=True, never published;
  - the target project must match WANDB_TARGET_PROJECT from the environment;
  - filters are built through typed FilterExpr constructors from structured
    triples with a closed op set — no string is ever parsed as an expression.

W&B platform caveat: strict inequalities are not supported by the backend;
wandb-workspaces maps '>' to '>=' and '<' to '<=' (with a UserWarning). Only
boundary-equal runs are affected.
"""

import json
import os
import sys

OPS = {"==", "!=", "in", ">", "<", ">=", "<="}
AGGS = {"median", "mean", "min", "max"}
PANEL_KINDS = {
    "scalar_by_axis",
    "bar_by_axis",
    "scatter",
    "parallel_coords",
    "axis_importance",
    "line",
}


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": str(message)[:500]}))
    sys.exit(0)  # the JSON line is the error signal; a clean exit keeps it last


def config_path(spec_key: str):
    """`config:axes/B1_Bias Activation Set.value` -> `axes/B1_Bias Activation Set`.

    Returns None when the key is not in spec form (i.e. it is a summary metric).
    The literal live-API form is what the §10 smoke test (smoke_test.py)
    confirms against a real run before first use.
    """
    if spec_key.startswith("config:") and spec_key.endswith(".value"):
        return spec_key[len("config:") : -len(".value")]
    return None


def metric_ref(wr, token: str):
    """A panel metric reference: config keys become wr.Config, summary metrics
    pass through as plain summary-metric names."""
    path = config_path(token)
    return wr.Config(path) if path is not None else token


def build_filters(expr, triples):
    out = []
    for t in triples:
        field, op, value = t["field"], t["op"], t["value"]
        if op not in OPS:
            raise ValueError(f"unsupported op {op!r}")
        if not isinstance(field, str):
            raise ValueError("filter field must be a string")
        if isinstance(value, str) and len(value) > 300:
            raise ValueError("filter value too long")
        path = config_path(field)
        base = expr.Config(path) if path is not None else expr.Summary(field)
        if op == "==":
            out.append(base == value)
        elif op == "!=":
            out.append(base != value)
        elif op == "in":
            if not isinstance(value, list):
                raise ValueError('op "in" requires an array value')
            out.append(base.isin(value))
        elif op == ">=":
            out.append(base >= value)
        elif op == "<=":
            out.append(base <= value)
        elif op == ">":  # platform maps strict to non-strict; see module docstring
            out.append(base >= value)
        elif op == "<":
            out.append(base <= value)
    return out


def build_runset(wr, expr, spec, extra_groupby=None):
    runset = spec.get("runset", {}) or {}
    filters = build_filters(expr, runset.get("filters", []) or [])
    groupby_keys = list(runset.get("groupby", []) or [])
    if extra_groupby and extra_groupby not in groupby_keys:
        groupby_keys.append(extra_groupby)
    groupby = []
    for key in groupby_keys:
        path = config_path(key)
        if path is None:
            raise ValueError(f"runset groupby must be a config key, got {key!r}")
        groupby.append(f"config.{path}")  # -> Key(section=config, name=<path>.value)
    kwargs = {
        "entity": spec["entity"],
        "project": spec["source_project"],
        "name": "Thesis runs",
    }
    if filters:
        kwargs["filters"] = filters
    if groupby:
        kwargs["groupby"] = groupby
    return wr.Runset(**kwargs)


def build_panel_grid(wr, expr, spec, panel):
    kind = panel["kind"]
    if kind not in PANEL_KINDS:
        raise ValueError(f"unsupported panel kind {kind!r}")
    title = panel.get("title") or None
    agg = panel.get("agg") or "median"
    if agg not in AGGS:
        raise ValueError(f"unsupported agg {agg!r}")
    extra_groupby = None

    if kind == "scalar_by_axis":
        # Grouping for a scalar chart lives on the runset, not the panel.
        extra_groupby = panel.get("groupby")
        p = wr.ScalarChart(title=title, metric=panel["metric"], groupby_aggfunc=agg)
    elif kind == "bar_by_axis":
        path = config_path(panel["groupby"])
        if path is None:
            raise ValueError("bar_by_axis groupby must be a config key")
        p = wr.BarPlot(
            title=title,
            metrics=[panel["metric"]],
            groupby=wr.Config(path),
            groupby_aggfunc=agg,
        )
    elif kind == "scatter":
        p = wr.ScatterPlot(title=title, x=metric_ref(wr, panel["x"]), y=metric_ref(wr, panel["metric"]))
    elif kind == "parallel_coords":
        columns = [
            wr.ParallelCoordinatesPlotColumn(metric=metric_ref(wr, c)) for c in panel["columns"]
        ]
        p = wr.ParallelCoordinatesPlot(title=title, columns=columns)
    elif kind == "axis_importance":
        p = wr.ParameterImportancePlot(with_respect_to=panel["metric"])
    else:  # line
        p = wr.LinePlot(title=title, x=panel.get("x") or "_step", y=[panel["metric"]])

    return wr.PanelGrid(runsets=[build_runset(wr, expr, spec, extra_groupby)], panels=[p])


def ensure_target_project(entity: str, target: str) -> None:
    """Create the quarantine project on first use. This is the only project
    this code may create — the canonical project is never touched."""
    try:
        import wandb

        api = wandb.Api()
        if target not in (p.name for p in api.projects(entity)):
            api.create_project(target, entity)
    except Exception:  # noqa: BLE001 — let the save surface the real error
        pass


def main() -> None:
    try:
        spec = json.loads(sys.stdin.read())
    except Exception as e:  # noqa: BLE001
        fail(f"invalid JSON on stdin: {e}")

    if not os.environ.get("WANDB_API_KEY"):
        fail("WANDB_API_KEY is not set")

    target_env = os.environ.get("WANDB_TARGET_PROJECT")
    target = spec.get("target_project")
    if not target or (target_env and target != target_env):
        fail(f"target_project {target!r} does not match the configured quarantine project")
    for required in ("entity", "source_project", "title", "blocks"):
        if not spec.get(required):
            fail(f"spec is missing {required!r}")

    try:
        import wandb_workspaces.reports.v2 as wr
        from wandb_workspaces import expr
    except Exception as e:  # noqa: BLE001
        fail(f"wandb-workspaces is not importable: {e}")

    ensure_target_project(spec["entity"], spec["target_project"])

    try:
        blocks = []
        for block in spec["blocks"]:
            btype = block.get("type")
            if btype == "heading":
                blocks.append(wr.H2(str(block["text"])))
            elif btype == "prose":
                blocks.append(wr.P(str(block["text"])))
            elif btype == "panel":
                blocks.append(build_panel_grid(wr, expr, spec, block))
            else:
                raise ValueError(f"unsupported block type {btype!r}")

        report = wr.Report(
            entity=spec["entity"],
            project=spec["target_project"],
            title=spec["title"],
            description=spec.get("description", ""),
            blocks=blocks,
        )
        report.save(draft=True)  # NEVER published (§6.3)
        print(json.dumps({"ok": True, "url": report.url}))
    except Exception as e:  # noqa: BLE001
        fail(e)


if __name__ == "__main__":
    main()
