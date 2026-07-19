<?xml version="1.0" encoding="UTF-8"?>
<instruction id="open-clipper-benchmark-improvement" version="4">

  <title>Improve Open Clipper tracking/crop quality from benchmark miss frames (coverage-based scoring)</title>

  <objective>
    Review an existing, frozen benchmark dataset and its completed test run.
    Inspect quantitative results and exported miss-frame JPEGs.
    Consult reference-algorithms for applicable detection, tracking, and crop strategies.
    Propose and implement code changes in the Open Clipper repository that improve
    coverage metrics (coverageHitRate, meanCoverageFraction) — without changing the
    dataset or any ground-truth annotations.
  </objective>

  <primaryGoal priority="critical">
    Maximize crop-box coverage of NON-BLACK image content using minimal-area rectangles.
    <point>
      Ground truth is now annotated as rectangles (9:16 in source pixel space). A target
      counts as hit when the crop viewport covers at least 85% of the target rectangle
      (COVERAGE_HIT_THRESHOLD = 0.85 in src/features/tests/benchmark/target-geometry.ts).
    </point>
    <point>
      Many source videos contain static black bars (letterbox/pillarbox). Black bars are
      dead pixels: any crop area spent on them is wasted and lowers effective coverage of
      real content. The pipeline must detect these borders and crop within the active
      image area only. The existing hook for this is contentRect
      ("source-space active image area after static letterbox borders are removed") in
      src/features/clipper/engine/autoflip/build-autoflip-track.ts and related stages
      (analyze-subjects.ts, analyze-faces.ts, smart-crop.ts, reframe.ts).
    </point>
    <point>
      Prefer the minimal-area crop rectangle that still covers the target content —
      do not inflate viewports to inflate coverage. Oversized crops that swallow black
      bars or off-target regions are a failure mode even when coverageHit is true
      (they degrade medianSubjectDisplayHeightFraction and output framing quality).
    </point>
  </primaryGoal>

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
      NEVER modify the test dataset, its annotations, keyframes, target rectangles,
      clips, videos, or any file under:
      %APPDATA%\com.openclipper.app\test-datasets\
      Treat ground truth as fixed. Do not relabel, re-annotate, delete, or rewrite
      dataset files. Do not change benchmark scoring thresholds (e.g. the 0.85
      coverage-hit threshold) to "cheat" metrics.
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
    <constraint id="no-coverage-gaming" severity="fatal">
      Do not maximize coverage by systematically enlarging crop viewports beyond what
      framing requires. Coverage gains must come from better subject selection, black-bar
      exclusion, tracking, and placement of minimal-area crops — not from zooming out.
    </constraint>
  </constraints>

  <inputs>
    <input name="arg1" required="true" source="chat">
      Read ARG1 from the user message text that follows this instruction.
      Extract runId, datasetId, and all artifact paths from ARG1 before doing anything else.
    </input>
    <input name="benchmarkMetrics" required="true">
      Using paths from ARG1, read the run manifest and/or SQLite (clipper.sqlite3).
      Extract per-clip and per-aspect coverage metrics for aspects: 9-16, 1-1, 4-5, 16-9:
      coverageHitRate, meanCoverageFraction, medianCoverageFraction, p5CoverageFraction,
      allTargetsCoveredFrameRate, single/dual-target hit rates, layoutModeRates,
      meanCoverageReacquisitionMs, and stability metrics (p95 viewport center
      velocity/acceleration, modeSwitchesPerMinute).
    </input>
    <input name="missFrameImages" required="true">
      Open JPEGs from the miss-frames directory given in ARG1.
      Filename format: {clipId}_{aspectId}_rank{NNN}_t{ms}ms_cov{fraction}_hit{0|1}.jpg
      cov is the worst per-target coverage fraction in the frame. Higher score = worse
      frame (a target failing the coverage hit adds a +10000 base to its score).
    </input>
    <input name="missFrameManifest" required="true">
      Read the per-clip {clipId}_{aspectId}_manifest.json in the miss-frames directory:
      per-frame score, coverageFraction, coverageHit, allTargetsCovered, normalized
      viewports, and per-target details.
    </input>
    <input name="referenceAlgorithms" required="true">
      Read and actively use material under:
      C:\Users\Adam\Desktop\01project_starling\open-clipper\reference-algorithms
      Treat this folder as the primary reference library for algorithm ideas, prior art,
      pseudocode, papers, ONNX/model notes, and integration sketches relevant to tracking,
      cropping, detection, salience, border/letterbox detection, and subject selection.
      Search it early in the workflow and cite specific files when proposing fixes.
    </input>
  </inputs>

  <referenceAlgorithms priority="high">
    <path>C:\Users\Adam\Desktop\01project_starling\open-clipper\reference-algorithms</path>
    <usage>
      The agent SHOULD consult this folder while working on benchmark improvements — not only
      may it draw inspiration, but it is expected to search it, read relevant entries, and
      weave applicable ideas into analysis and implementation plans (including the chat prompt
      and proposed code changes). Prefer algorithms and patterns documented there when they
      match an observed miss-frame failure mode (e.g. border detection for black bars,
      minimal-area crop placement, salience-driven subject selection).
    </usage>
    <rules>
      <rule>Read-only: do not modify files in reference-algorithms unless the user explicitly asks.</rule>
      <rule>Port ideas into production code under src/ and src-tauri/; do not depend on runtime reads from this folder.</rule>
      <rule>When a reference entry suggests a model or detector, respect stack constraints (WinML ONNX vs WASM/MediaPipe) already noted in docs/next-iteration-algorithms.md.</rule>
    </rules>
  </referenceAlgorithms>

  <missFrameVisualLegend>
    <item color="red">Crop viewport rectangle produced by the tracker</item>
    <item color="colored-rectangles">Ground-truth target rectangles (annotated, immutable, 9:16 in pixel space)</item>
    <item>coverageHit = true when the viewport covers &gt;= 0.85 of the target rectangle area</item>
    <item>coverageHit = false = primary failure mode to fix in code</item>
    <item>Watch for black letterbox/pillarbox bars inside the red viewport — crop area spent on black bars is a failure signal even on hit frames</item>
  </missFrameVisualLegend>

  <workflow>
    <step order="1">
      Parse ARG1 from the chat message (text pasted right after this instruction).
      Resolve all artifact paths on disk. If ARG1 is missing or incomplete, ask the user
      to paste it before proceeding.
    </step>
    <step order="2">
      Summarize benchmark results: worst clips/aspects by coverageHitRate and
      meanCoverageFraction (also check p5CoverageFraction for tail failures).
      Note systematic patterns (e.g. one aspect ratio, fast motion, target loss,
      crop lag, edge framing, black bars eating crop area).
    </step>
    <step order="3">
      Inspect the top ~20 worst miss frames (highest score in manifest).
      For each failure cluster, identify the likely pipeline stage:
      border/letterbox detection (contentRect), subject detection, tracking, smoothing,
      aspect crop / layout arbitration, crop placement and sizing.
      Explicitly check whether the source clip has black bars and whether the crop
      respected the active image area.
    </step>
    <step order="3b">
      For each failure cluster, search reference-algorithms
      (C:\Users\Adam\Desktop\01project_starling\open-clipper\reference-algorithms)
      for matching algorithms, heuristics, or integration notes. Use them in the prompt and
      in the proposed fix — name the reference file(s) and how they map to the pipeline stage.
    </step>
    <step order="4">
      Trace relevant code under C:\Users\Adam\Desktop\01project_starling\open-clipper.
      Key areas to search:
      - src/features/clipper/engine/autoflip/ (layout arbiter, coveredFraction, build-autoflip-track with contentRect / static border removal)
      - src/features/clipper/pipeline/stages/ (analyze-subjects, analyze-faces — letterbox-aware detection)
      - src/features/clipper/ (frontend crop/tracking engine, smart-crop, reframe)
      - src/features/tests/benchmark/ (metrics, target-geometry, runner — read-only for scoring rules)
      - src-tauri/src/ (Rust video/decode/export, benchmark_miss_export.rs if applicable)
    </step>
    <step order="5">
      Propose concrete code changes with rationale tied to specific miss-frame evidence
      and, where applicable, reference-algorithms entries consulted in step 3b.
      Prefer minimal, general fixes over per-clip hacks. Prioritize fixes that
      (a) exclude black bars from crop area and (b) place minimal-area crops that
      cover the target content.
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
      Report: what failed visually, what code changed, before/after coverage metrics per
      aspect, and whether any regressions appeared on previously good clips — including
      framing regressions (medianSubjectDisplayHeightFraction, stability metrics) that
      would indicate coverage was bought by zooming out.
    </step>
  </workflow>

  <deliverables>
    <deliverable>Written analysis linking miss-frame visuals to root causes and any reference-algorithms sources used</deliverable>
    <deliverable>Code diff limited to C:\Users\Adam\Desktop\01project_starling\open-clipper</deliverable>
    <deliverable>Before/after benchmark metric table (same dataset, new run): coverageHitRate, meanCoverageFraction, p5CoverageFraction per aspect</deliverable>
    <deliverable>List of remaining failure modes if metrics did not fully recover</deliverable>
  </deliverables>

  <metricsGlossary>
    <metric name="coverageFraction">
      Fraction of a ground-truth target rectangle's area covered by the best crop viewport
      in that frame (max over viewports). Range 0–1. Higher is better.
    </metric>
    <metric name="coverageHitRate">
      Fraction of target observations where coverageFraction &gt;= 0.85
      (COVERAGE_HIT_THRESHOLD). Primary metric. Higher is better.
    </metric>
    <metric name="meanCoverageFraction / medianCoverageFraction / p5CoverageFraction">
      Distribution of coverageFraction across all target observations. p5 exposes tail
      failures (brief target loss, black-bar mis-crops). Higher is better.
    </metric>
    <metric name="allTargetsCoveredFrameRate">
      Fraction of frames where every visible target passes the coverage hit. Strictest
      per-frame view; important for dual-target (split-layout) clips.
    </metric>
    <metric name="meanCoverageReacquisitionMs">
      Mean time to regain a coverage hit after losing one. Lower is better.
    </metric>
    <metric name="missFrameScore">
      Per-frame ranking score used for export selection: (1 - coverageFraction), plus a
      +10000 base per target that fails the coverage hit. Highest scores are exported.
    </metric>
    <metric name="medianSubjectDisplayHeightFraction">
      How large subjects appear in the output crop. Guards against gaming coverage by
      zooming out — it must not regress while coverage improves.
    </metric>
  </metricsGlossary>

  <forbiddenActions>
    <action>Editing files under test-datasets in AppData</action>
    <action>Changing annotations, keyframes, or GT target rectangles</action>
    <action>Replacing or trimming benchmark clips/videos</action>
    <action>Hard-coding dataset-specific exceptions</action>
    <action>Lowering the 0.85 coverage-hit threshold or otherwise relaxing scoring instead of fixing cropping</action>
    <action>Inflating crop viewports (zooming out) as a blanket way to raise coverage</action>
    <action>Modifying anything outside C:\Users\Adam\Desktop\01project_starling\open-clipper</action>
  </forbiddenActions>

  <repositoryRoot>C:\Users\Adam\Desktop\01project_starling\open-clipper</repositoryRoot>
  <workingDirectory>PS C:\Users\Adam\Desktop\01project_starling\open-clipper</workingDirectory>

</instruction>
