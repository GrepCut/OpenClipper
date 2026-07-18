<?xml version="1.0" encoding="UTF-8"?>
<instruction id="open-clipper-benchmark-improvement" version="2">

  <title>Improve Open Clipper tracking/crop quality from benchmark miss frames</title>

  <objective>
    Review an existing, frozen benchmark dataset and its completed test run.
    Inspect quantitative results and exported miss-frame JPEGs.
    Propose and implement code changes in the Open Clipper repository that improve
    focusHit metrics — without changing the dataset or any ground-truth annotations.
  </objective>

  <chatLayout>
    This XML instruction is message part 1.
    The user will paste ARG1 directly below it in the same chat message (message part 2).
    ARG1 is the run description: runId, datasetId, artifact paths, and any notes.
    Do not look for ARG1 on disk — treat the pasted text as the authoritative run brief.
  </chatLayout>

  <arg1>
    <delivery>inline — pasted by the user immediately after this instruction in the chat</delivery>
    <contains>
      - benchmark runId and datasetId
      - paths to run manifest.json and per-clip jsonl details
      - paths to miss-frames export directory and manifest.json
      - optional notes about known failure patterns
    </contains>
    <example format="markdown-or-plain-text">
      See run1.MD in the repo for a typical ARG1 shape (paths only; do not require that file to exist).
    </example>
  </arg1>

  <constraints priority="critical">
    <constraint id="dataset-immutable" severity="fatal">
      NEVER modify the test dataset, its annotations, keyframes, target circles,
      clips, videos, or any file under:
      %APPDATA%\com.openclipper.app\test-datasets\
      Treat ground truth as fixed. Do not relabel, re-annotate, delete, or rewrite
      dataset files. Do not change benchmark scoring thresholds to "cheat" metrics.
    </constraint>
    <constraint id="code-only" severity="fatal">
      The ONLY files you may edit are source code inside the repository at:
      C:\Users\Adam\Desktop\01project_starling\open-clipper
      Do not modify AppData artifacts except by re-running benchmarks after a code fix.
    </constraint>
    <constraint id="no-dataset-workarounds" severity="fatal">
      Do not exclude clips, skip aspects, filter keyframes, or special-case individual
      dataset entries. Fixes must generalize in the tracking/crop pipeline.
    </constraint>
  </constraints>

  <inputs>
    <input name="arg1" required="true" source="chat">
      Read ARG1 from the user message text that follows this instruction.
      Extract runId, datasetId, and all artifact paths from ARG1 before doing anything else.
    </input>
    <input name="benchmarkMetrics" required="true">
      Using paths from ARG1, read the run manifest and/or SQLite (clipper.sqlite3).
      Extract per-clip and per-aspect focusHitRate and meanFocusErrorRadius
      for aspects: 9-16, 1-1, 4-5, 16-9.
    </input>
    <input name="missFrameImages" required="true">
      Open JPEGs from the miss-frames directory given in ARG1.
      Filenames encode: clipId, aspectId, rank, timestamp (ms), error score, visibility.
      Higher score = worse frame (invisible targets add +10000 base).
    </input>
    <input name="missFrameManifest" required="true">
      Read miss-frames/manifest.json at the path from ARG1: per-frame score, focusHit,
      focusErrorRadius, normalized viewports, and target details.
    </input>
  </inputs>

  <missFrameVisualLegend>
    <item color="red">Crop viewport rectangle produced by the tracker</item>
    <item color="colored-circles">Ground-truth target circles (annotated, immutable)</item>
    <item>focusHit = true when focusErrorRadius &lt;= 1.0 (error within one GT radius)</item>
    <item>focusHit = false or invisible target = primary failure modes to fix in code</item>
  </missFrameVisualLegend>

  <workflow>
    <step order="1">
      Parse ARG1 from the chat message (text pasted right after this instruction).
      Resolve all artifact paths on disk. If ARG1 is missing or incomplete, ask the user
      to paste it before proceeding.
    </step>
    <step order="2">
      Summarize benchmark results: worst clips/aspects by focusHitRate and
      meanFocusErrorRadius. Note systematic patterns (e.g. one aspect ratio, fast motion,
      target loss, crop lag, edge framing).
    </step>
    <step order="3">
      Inspect the top ~20 worst miss frames (highest score in manifest).
      For each failure cluster, identify the likely pipeline stage:
      detection, tracking, smoothing, aspect crop, focus point selection.
    </step>
    <step order="4">
      Trace relevant code under C:\Users\Adam\Desktop\01project_starling\open-clipper.
      Key areas to search:
      - src/features/clipper/ (frontend crop/tracking engine)
      - src/features/tests/benchmark/ (metrics, runner — read-only for scoring rules)
      - src-tauri/src/ (Rust video/decode/export if applicable)
    </step>
    <step order="5">
      Propose concrete code changes with rationale tied to specific miss-frame evidence.
      Prefer minimal, general fixes over per-clip hacks.
    </step>
    <step order="6">
      Implement changes only inside the repository path above.
      Rebuild if Rust changed: npm run tauri:build:fast
      Close the GUI app before re-benchmarking (SQLite lock).
    </step>
    <step order="7">
      Re-run benchmark on the SAME dataset id from ARG1 (do not modify the dataset):
      .\src-tauri\target\release\open-clipper.exe --benchmark-run &lt;dataset-id&gt; --json
      Compare new metrics against the baseline run identified in ARG1.
    </step>
    <step order="8">
      Report: what failed visually, what code changed, before/after metrics per aspect,
      and whether any regressions appeared on previously good clips.
    </step>
  </workflow>

  <deliverables>
    <deliverable>Written analysis linking miss-frame visuals to root causes</deliverable>
    <deliverable>Code diff limited to C:\Users\Adam\Desktop\01project_starling\open-clipper</deliverable>
    <deliverable>Before/after benchmark metric table (same dataset, new run)</deliverable>
    <deliverable>List of remaining failure modes if metrics did not fully recover</deliverable>
  </deliverables>

  <metricsGlossary>
    <metric name="focusHitRate">
      Fraction of target observations where crop focus error is within 1× annotated radius.
      Higher is better. Target: improve without dataset changes.
    </metric>
    <metric name="meanFocusErrorRadius">
      Mean focus error in radius units. Values &lt;= 1.0 are within tolerance.
      Lower is better.
    </metric>
    <metric name="missFrameScore">
      Per-frame ranking score used for export selection. Invisible targets rank highest.
    </metric>
  </metricsGlossary>

  <forbiddenActions>
    <action>Editing files under test-datasets in AppData</action>
    <action>Changing annotations, keyframes, or GT circles</action>
    <action>Replacing or trimming benchmark clips/videos</action>
    <action>Hard-coding dataset-specific exceptions</action>
    <action>Lowering scoring strictness instead of fixing tracking</action>
    <action>Modifying anything outside C:\Users\Adam\Desktop\01project_starling\open-clipper</action>
  </forbiddenActions>

  <repositoryRoot>C:\Users\Adam\Desktop\01project_starling\open-clipper</repositoryRoot>
  <workingDirectory>PS C:\Users\Adam\Desktop\01project_starling\open-clipper</workingDirectory>

</instruction>
