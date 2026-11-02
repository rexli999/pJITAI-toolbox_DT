#!/usr/bin/env python3
"""Convert the decision-tree CSV into the data used by the decision tree UI.

Every page's tree is validated first. The script exits with status 1 if any
page has errors, so a typo in the CSV never reaches the UI.

Usage:
    python scripts/csv_to_trees.py decision_trees.csv --js trees.js
    python scripts/csv_to_trees.py decision_trees.csv --js trees.js \\
        --single-file decision_tree_prototype.html --template index.html
"""
import argparse
import csv
import json
import os
import re
import sys
from collections import OrderedDict

REQUIRED_COLUMNS = ["page", "id", "kind", "from", "to", "label", "detail"]
NODE_KINDS = ("decision", "instruction")
EDGE_KIND = "edge"
EDGE_TONES = ("green", "orange")   # optional 'tone' column: tints an option and its arrow label
ALLOWED_TAGS = {"a", "b", "strong", "i", "em", "sub", "sup", "ul", "ol", "li", "br", "p", "code"}
MAX_NODE_LABEL = 60
MAX_EDGE_LABEL = 40
TAG_RE = re.compile(r"</?\s*([a-zA-Z][a-zA-Z0-9]*)")
SCRIPT_RE = re.compile(r'<script src="([^"]+)"></script>')
LINK_RE = re.compile(r'<link rel="stylesheet" href="([^"]+)">')
BULLET_RE = re.compile(r"^\s*[-*]\s+(.*)")
NUMBERED_RE = re.compile(r"^\s*\d+[.)]\s+(.*)")
INLINE_MARKDOWN = [
    (re.compile(r"`([^`]+)`"), r"<code>\1</code>"),
    (re.compile(r"\*\*(.+?)\*\*"), r"<b>\1</b>"),
    (re.compile(r"(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)"), r"<i>\1</i>"),
    (re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)"), r'<a href="\2">\1</a>'),
    (re.compile(r"~([^~\s]+)~"), r"<sub>\1</sub>"),     # α~0~ -> α<sub>0</sub>
    (re.compile(r"\^([^^\s]+)\^"), r"<sup>\1</sup>"),   # σ^2^ -> σ<sup>2</sup>
]


def markdown_to_html(text):
    """Convert the Markdown subset allowed in 'detail' cells to HTML.

    Blank line = new paragraph, line break = <br>, "- " / "* " bullets,
    "1. " numbered lists, **bold**, *italic*, `code`, [text](url),
    α~0~ subscript and σ^2^ superscript. HTML passes through unchanged, and a
    single paragraph is not wrapped in <p>, so HTML-only cells come out as-is.
    """
    segments = []  # (is_text, html) per paragraph or list

    def inline(s):
        for pattern, repl in INLINE_MARKDOWN:
            s = pattern.sub(repl, s)
        return s

    for para in re.split(r"\n[ \t]*\n", text.strip()):
        lines, items, list_tag = [], [], None
        for line in para.split("\n") + [None]:
            m_bullet = line is not None and BULLET_RE.match(line)
            m = m_bullet or (line is not None and NUMBERED_RE.match(line))
            tag = "ul" if m_bullet else "ol"
            # Close the open list or paragraph when the block type changes
            if items and (not m or tag != list_tag):
                segments.append((False, "<%s>%s</%s>" % (
                    list_tag, "".join("<li>%s</li>" % i for i in items), list_tag)))
                items = []
            if lines and m or line is None and lines:
                segments.append((True, "<br>".join(lines)))
                lines = []
            if m:
                list_tag = tag
                items.append(inline(m.group(1).strip()))
            elif line is not None and line.strip():
                lines.append(inline(line.strip()))

    if len(segments) == 1 and segments[0][0]:
        return segments[0][1]
    return "".join("<p>%s</p>" % html if is_text else html for is_text, html in segments)


def load_rows(csv_path):
    # utf-8-sig strips the byte-order mark that Excel adds to "CSV UTF-8" exports
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        columns = [c.strip() for c in (reader.fieldnames or [])]
        missing = [c for c in REQUIRED_COLUMNS if c not in columns]
        if missing:
            sys.exit("CSV is missing column(s): %s" % ", ".join(missing))
        rows = []
        # Row numbers match the spreadsheet (header is row 1)
        for row_no, row in enumerate(reader, start=2):
            clean = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            if any(clean.values()):
                clean["_where"] = "row %d" % row_no
                rows.append(clean)
    return rows


def build_trees(rows):
    """Group rows by page and validate each tree. Returns (trees, errors, warnings)."""
    pages = OrderedDict()
    errors = []
    for row in rows:
        where = row["_where"]
        if not row["page"]:
            errors.append("%s: missing 'page'" % where)
            continue
        tree = pages.setdefault(row["page"], {"nodes": [], "edges": []})
        kind = row["kind"].lower()
        if kind in NODE_KINDS:
            tree["nodes"].append({"id": row["id"], "kind": kind, "label": row["label"],
                                  "detail": markdown_to_html(row["detail"]), "_where": where})
        elif kind == EDGE_KIND:
            order = None
            if row.get("order"):
                try:
                    order = int(row["order"])
                except ValueError:
                    errors.append("%s: 'order' must be a whole number" % where)
            edge = {"id": row["id"] or "%s__%s" % (row["from"], row["to"]),
                    "from": row["from"], "to": row["to"], "label": row["label"],
                    "detail": markdown_to_html(row["detail"]), "order": order, "_where": where}
            tone = row.get("tone", "").lower()
            if tone in EDGE_TONES:
                edge["tone"] = tone
            elif tone:
                errors.append("%s: 'tone' must be %s or empty (got %r)"
                              % (where, " or ".join(EDGE_TONES), row["tone"]))
            tree["edges"].append(edge)
        else:
            errors.append("%s: kind must be decision, instruction or edge (got %r)"
                          % (where, row["kind"]))

    warnings = []
    for page, tree in pages.items():
        page_errors, page_warnings = validate_tree(tree)
        errors += ["[%s] %s" % (page, m) for m in page_errors]
        warnings += ["[%s] %s" % (page, m) for m in page_warnings]
        # Stable sort: edges with an 'order' come first, in that order; the rest keep CSV order
        tree["edges"].sort(key=lambda e: (e["order"] is None, e["order"] or 0))
        for item in tree["nodes"] + tree["edges"]:
            item.pop("_where", None)
    return pages, errors, warnings


def validate_tree(tree):
    errors, warnings = [], []
    nodes = OrderedDict()
    for n in tree["nodes"]:
        if not n["id"]:
            errors.append("%s: node is missing 'id'" % n["_where"])
        elif n["id"] in nodes:
            errors.append("%s: duplicate node id %r" % (n["_where"], n["id"]))
        else:
            nodes[n["id"]] = n
        if not n["label"]:
            errors.append("%s: node %r is missing 'label'" % (n["_where"], n["id"]))
        elif len(n["label"]) > MAX_NODE_LABEL:
            warnings.append("%s: node label is %d characters (aim for <= %d)"
                            % (n["_where"], len(n["label"]), MAX_NODE_LABEL))

    children = {nid: [] for nid in nodes}
    has_parent = set()
    edge_ids = set()
    for e in tree["edges"]:
        if e["id"] in edge_ids:
            errors.append("%s: duplicate edge %r" % (e["_where"], e["id"]))
        edge_ids.add(e["id"])
        missing_end = False
        for end in ("from", "to"):
            if e[end] not in nodes:
                errors.append("%s: edge '%s' value %r is not a node on this page"
                              % (e["_where"], end, e[end]))
                missing_end = True
        if missing_end:
            continue
        if e["from"] == e["to"]:
            errors.append("%s: edge points from %r to itself" % (e["_where"], e["from"]))
            continue
        children[e["from"]].append(e["to"])
        has_parent.add(e["to"])
        if nodes[e["from"]]["kind"] == "decision" and not e["label"]:
            errors.append("%s: edges leaving a decision need a 'label'" % e["_where"])
        if len(e["label"]) > MAX_EDGE_LABEL:
            warnings.append("%s: edge label is %d characters (aim for <= %d)"
                            % (e["_where"], len(e["label"]), MAX_EDGE_LABEL))

    for item in tree["nodes"] + tree["edges"]:
        bad = sorted({t.lower() for t in TAG_RE.findall(item["detail"])} - ALLOWED_TAGS)
        if bad:
            errors.append("%s: 'detail' uses HTML tag(s) not allowed: %s"
                          % (item["_where"], ", ".join(bad)))

    for nid, n in nodes.items():
        out = len(children[nid])
        if n["kind"] == "decision" and out < 2:
            errors.append("%s: decision %r needs at least 2 outgoing edges (has %d)"
                          % (n["_where"], nid, out))
        if n["kind"] == "instruction" and out > 1:
            errors.append("%s: instruction %r can have at most 1 outgoing edge (has %d)"
                          % (n["_where"], nid, out))

    roots = [nid for nid in nodes if nid not in has_parent]
    if len(roots) != 1:
        errors.append("expected exactly one root (a node with no incoming edge), found %d: %s"
                      % (len(roots), ", ".join(roots) or "none"))
        return errors, warnings

    # Depth-first search from the root: finds cycles and unreachable nodes
    state = {}  # node id -> "visiting" | "done"

    def visit(nid):
        state[nid] = "visiting"
        for child in children[nid]:
            if state.get(child) == "visiting":
                errors.append("cycle: %r leads back to %r" % (nid, child))
            elif child not in state:
                visit(child)
        state[nid] = "done"

    visit(roots[0])
    unreachable = [nid for nid in nodes if nid not in state]
    if unreachable:
        errors.append("not reachable from root %r: %s" % (roots[0], ", ".join(unreachable)))
    return errors, warnings


def to_js(trees):
    # Escaping "</" keeps the data safe to inline inside a <script> tag
    data = json.dumps(trees, ensure_ascii=False, indent=2).replace("</", "<\\/")
    return ("// Generated by scripts/csv_to_trees.py. Edit the CSV, not this file.\n"
            "window.TREES = %s;\n" % data)


def build_single_file(template_path, trees_js):
    """Inline local scripts and stylesheets so the page works as one shareable file."""
    base = os.path.dirname(os.path.abspath(template_path))

    def read(rel):
        with open(os.path.join(base, rel), encoding="utf-8") as f:
            return f.read()

    def inline_script(m):
        src = m.group(1)
        code = trees_js if os.path.basename(src) == "trees.js" else read(src)
        return "<script>\n%s\n</script>" % code.replace("</script", "<\\/script")

    def inline_style(m):
        return "<style>\n%s\n</style>" % read(m.group(1))

    with open(template_path, encoding="utf-8") as f:
        html = f.read()
    html = SCRIPT_RE.sub(inline_script, html)
    return LINK_RE.sub(inline_style, html)


def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote %s" % path)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("csv", help="decision-tree CSV")
    parser.add_argument("--js", help="write window.TREES = {...} to this .js file")
    parser.add_argument("--json", help="write the trees as JSON to this file")
    parser.add_argument("--single-file", help="write a self-contained HTML page to this file")
    parser.add_argument("--template", help="HTML page to inline for --single-file")
    args = parser.parse_args()
    if args.single_file and not args.template:
        parser.error("--single-file needs --template")

    trees, errors, warnings = build_trees(load_rows(args.csv))
    for w in warnings:
        print("warning: %s" % w)
    if errors:
        for e in errors:
            print("error: %s" % e)
        sys.exit(1)
    for page, tree in trees.items():
        print("%s: %d nodes, %d edges" % (page, len(tree["nodes"]), len(tree["edges"])))

    trees_js = to_js(trees)
    if args.js:
        write(args.js, trees_js)
    if args.json:
        write(args.json, json.dumps(trees, ensure_ascii=False, indent=2) + "\n")
    if args.single_file:
        write(args.single_file, build_single_file(args.template, trees_js))


if __name__ == "__main__":
    main()
