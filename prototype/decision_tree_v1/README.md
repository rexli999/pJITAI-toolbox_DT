# Decision tree prototype v1

> **v1 is the working version.** It started as a copy of `../decision_tree_v0/` (2026-11-02).

A standalone prototype of the interactive Resources decision tree for Model Settings pages. It needs no Flask, MySQL or internet connection.

## View it

Open `index.html` in a browser by double-clicking it.

## Edit the content

1. Edit `decision_trees.csv`. If you use Excel, save it as "CSV UTF-8".
   On an edge row, the optional `tone` column (`green` or `orange`) lightly tints that option card and its arrow label,
   so readers can match the two.
   Format `detail` cells with Markdown: a blank line starts a new paragraph, `- ` starts a bullet,
   `**bold**`, `*italic*`, `[link text](https://…)`, and `α~0~` / `σ^2^` for subscript and superscript.
2. Regenerate the data and the single-file version. Run this from this folder:
   ```
   python3 ../../scripts/csv_to_trees.py decision_trees.csv --js trees.js \
       --single-file decision_tree_prototype.html --template index.html
   ```
   The script validates every tree first. If anything is wrong, it prints the CSV row numbers and writes nothing.
3. Reload `index.html`.

## Share it

`decision_tree_prototype.html` contains everything inlined, so you can send just that one file. It opens on any computer. Alternatively, zip this whole folder.

## Files

| File | Purpose | Moves into the toolbox at M3? |
|---|---|---|
| `decision_tree.js` | Renderer: `renderDecisionTree()` | yes |
| `decision_tree.css` | Component styles and `--dt-*` colour variables (light and `body.dark`) | yes |
| `vendor/` | Cytoscape.js 3.30.2, dagre 0.8.5, cytoscape-dagre 2.5.0 | yes |
| `decision_trees.csv` | Tree content (source of truth) | yes |
| `trees.js`, `decision_tree_prototype.html` | Generated; do not edit by hand | no |
| `index.html` | Mock toolbox page around the component | no |
