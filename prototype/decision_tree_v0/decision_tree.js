/*
 * Interactive decision tree for the Resources section.
 * Needs cytoscape, dagre and cytoscape-dagre loaded first.
 *
 *   var dt = renderDecisionTree(containerEl, tree, detailEl);
 *   dt.back(); dt.reset(); dt.fit(); dt.zoomBy(1.2); dt.select('node_id'); dt.destroy();
 *
 * tree = {nodes: [{id, kind, label, detail}], edges: [{id, from, to, label, detail, order}]}
 * Colours come from the --dt-* CSS variables in decision_tree.css, so the
 * diagram follows the page theme (body.dark).
 */
(function (global) {
  'use strict';

  var TEXT_WIDTH = 170;   // max width of a node's label, px
  var FONT_SIZE = 13;
  var LINE_HEIGHT = 17;
  var MAX_HEIGHT = 640;   // the diagram never grows taller than this
  var KIND_NAMES = { decision: 'Decision', instruction: 'Step' };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Cytoscape can't size a node to its wrapped label, so count the lines ourselves
  var measureCtx;
  function countLines(text, font) {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    var lines = 1, line = '';
    String(text).split(/\s+/).forEach(function (word) {
      var test = line ? line + ' ' + word : word;
      if (line && measureCtx.measureText(test).width > TEXT_WIDTH) {
        lines += 1;
        line = word;
      } else {
        line = test;
      }
    });
    return lines;
  }

  function readTheme(el) {
    var cs = getComputedStyle(el);
    function v(name) { return cs.getPropertyValue(name).trim(); }
    return {
      font: cs.fontFamily,
      bg: v('--dt-bg'),
      text: v('--dt-text'),
      decisionBg: v('--dt-decision-bg'),
      decisionBorder: v('--dt-decision-border'),
      instructionBg: v('--dt-instruction-bg'),
      instructionBorder: v('--dt-instruction-border'),
      edge: v('--dt-edge'),
      edgeText: v('--dt-edge-text'),
      highlight: v('--dt-highlight')
    };
  }

  function buildStyle(t) {
    return [
      { selector: 'node', style: {
        'label': 'data(label)', 'text-wrap': 'wrap', 'text-max-width': TEXT_WIDTH,
        'text-valign': 'center', 'text-halign': 'center', 'line-height': LINE_HEIGHT / FONT_SIZE,
        'font-size': FONT_SIZE, 'font-family': t.font, 'color': t.text,
        'width': 'data(w)', 'height': 'data(h)', 'border-width': 2,
        'overlay-opacity': 0, 'transition-property': 'opacity', 'transition-duration': 150 } },
      { selector: 'node[kind = "decision"]', style: {
        'shape': 'round-hexagon', 'background-color': t.decisionBg,
        'border-color': t.decisionBorder, 'font-weight': 600 } },
      { selector: 'node[kind = "instruction"]', style: {
        'shape': 'round-rectangle', 'background-color': t.instructionBg,
        'border-color': t.instructionBorder } },
      { selector: 'edge', style: {
        'curve-style': 'bezier', 'width': 2, 'line-color': t.edge,
        'target-arrow-color': t.edge, 'target-arrow-shape': 'triangle', 'arrow-scale': 1.1,
        'label': 'data(label)', 'font-size': 12, 'font-family': t.font, 'color': t.edgeText,
        'text-background-color': t.bg, 'text-background-opacity': 1,
        'text-background-padding': 3, 'text-background-shape': 'round-rectangle',
        'overlay-opacity': 0, 'transition-property': 'opacity', 'transition-duration': 150 } },
      { selector: 'node.on-path', style: { 'border-color': t.highlight } },
      { selector: 'edge.on-path', style: {
        'width': 3, 'line-color': t.highlight, 'target-arrow-color': t.highlight } },
      { selector: 'node.selected', style: { 'border-width': 4, 'border-color': t.highlight } },
      { selector: 'edge.selected', style: {
        'width': 4, 'line-color': t.highlight, 'target-arrow-color': t.highlight,
        'underlay-color': t.highlight, 'underlay-opacity': 0.15, 'underlay-padding': 4 } },
      { selector: '.dimmed', style: { 'opacity': 0.3 } }
    ];
  }

  function buildElements(tree, theme) {
    var font = FONT_SIZE + 'px ' + theme.font;
    var els = tree.nodes.map(function (n) {
      var isDecision = n.kind === 'decision';
      var lines = countLines(n.label, (isDecision ? '600 ' : '') + font);
      return { group: 'nodes', data: {
        id: n.id, kind: n.kind, label: n.label, detail: n.detail || '',
        w: TEXT_WIDTH + (isDecision ? 60 : 28),
        h: lines * LINE_HEIGHT + (isDecision ? 32 : 22) } };
    });
    tree.edges.forEach(function (e) {
      els.push({ group: 'edges', data: {
        id: 'edge:' + e.id, source: e.from, target: e.to, kind: 'edge',
        label: e.label || '', detail: e.detail || '' } });
    });
    return els;
  }

  function goButton(target, text, via, extraClass) {
    return '<button type="button" class="dt-btn ' + (extraClass || '') + '" data-go="' +
      escapeHtml(target.id()) + '"' + (via ? ' data-via="' + escapeHtml(via.id()) + '"' : '') +
      '>' + text + '</button>';
  }

  function renderDecisionTree(container, tree, detailEl) {
    var theme = readTheme(container);
    var cy = cytoscape({
      container: container,
      elements: buildElements(tree, theme),
      style: buildStyle(theme),
      userZoomingEnabled: false,   // don't hijack page scrolling; use the zoom buttons
      boxSelectionEnabled: false,
      autoungrabify: true,
      autounselectify: true,
      minZoom: 0.3,
      maxZoom: 1.6
    });
    cy.layout({ name: 'dagre', rankDir: 'TB', nodeSep: 36, rankSep: 64, edgeSep: 16 }).run();
    var root = cy.nodes().roots().first();

    function fit() {
      cy.fit(undefined, 20);
      if (cy.zoom() > 1) {
        cy.zoom(1);
        cy.center();
      }
    }

    function sizeToContent() {
      var bb = cy.elements().boundingBox();
      var zoom = Math.min(1, ((container.clientWidth || 600) - 40) / bb.w);
      container.style.height = Math.min(MAX_HEIGHT, Math.max(240, bb.h * zoom + 40)) + 'px';
      cy.resize();
      fit();
    }

    function highlight(node) {
      cy.elements().removeClass('selected on-path dimmed');
      if (!node) return;
      var path = node.predecessors();
      var next = node.outgoers();
      path.addClass('on-path');
      node.addClass('selected');
      cy.elements().not(path).not(next).not(node).addClass('dimmed');
    }

    function optionDesc(edge) {
      return edge.data('detail') ? '<div class="dt-option-desc">' + edge.data('detail') + '</div>' : '';
    }

    // Edge text lives in the parent node's panel: one option per outgoing edge
    function nextHtml(node) {
      var out = node.outgoers('edge');
      if (!out.length) {
        return '<div class="dt-detail-next"><p class="dt-detail-end">This is the last step.</p>' +
          goButton(root, 'Start over', null, 'dt-btn-secondary') + '</div>';
      }
      if (node.data('kind') !== 'decision') {
        return '<div class="dt-detail-next">' +
          goButton(out[0].target(), 'Next: ' + escapeHtml(out[0].target().data('label')), out[0]) +
          optionDesc(out[0]) + '</div>';
      }
      return '<div class="dt-detail-next"><div class="dt-detail-next-title">Your options</div>' +
        out.map(function (e) {
          return '<div class="dt-option" data-go="' + escapeHtml(e.target().id()) + '" data-via="' +
            escapeHtml(e.id()) + '"><button type="button" class="dt-option-label">' +
            escapeHtml(e.data('label')) + '</button>' + optionDesc(e) + '</div>';
        }).join('') + '</div>';
    }

    // Clicking an arrow opens its parent node and points out the matching option
    function focusOption(edge) {
      edge.addClass('selected');
      Array.prototype.forEach.call(detailEl.querySelectorAll('[data-via]'), function (opt) {
        if (opt.getAttribute('data-via') === edge.id()) opt.classList.add('dt-option-focus');
      });
    }

    function backHtml() {
      if (!history.length) return '';
      var prev = history[history.length - 1].ele;
      var title = prev ? prev.data('label') : 'Start';
      return '<button type="button" class="dt-back" data-back title="Back to: ' + escapeHtml(title) +
        '">← Back</button>';
    }

    function showDetail(node, via) {
      if (!node) {
        detailEl.innerHTML = backHtml() + '<p class="dt-detail-empty">Click any box or arrow in the diagram ' +
          'to see more detail here.</p>' + goButton(root, 'Start at the top');
        return;
      }
      var d = node.data();
      var html = backHtml() +
        '<span class="dt-detail-kind dt-kind-' + d.kind + '">' + KIND_NAMES[d.kind] + '</span>';
      if (via && via.data('label')) {
        html += '<div class="dt-detail-via">You chose: <b>' + escapeHtml(via.data('label')) + '</b></div>';
      }
      html += '<h4 class="dt-detail-title">' + escapeHtml(d.label) + '</h4>';
      if (d.detail) html += '<div class="dt-detail-body">' + d.detail + '</div>';
      detailEl.innerHTML = html + nextHtml(node);
      Array.prototype.forEach.call(detailEl.querySelectorAll('.dt-detail-body a, .dt-option-desc a'), function (a) {
        a.target = '_blank';
        a.rel = 'noopener';
      });
    }

    // Previously shown panels, for the Back button. Going back doesn't add to it.
    var history = [];
    var current = { ele: null, via: null };

    function select(ele, via, isBack) {
      ele = ele && ele.length ? ele : null;
      var same = ele && current.ele && ele.same(current.ele);
      if (!isBack && !same && (current.ele || history.length)) history.push(current);
      current = { ele: ele, via: via };
      highlight(ele);
      showDetail(ele, via);
      if (ele) {
        // Bring the node into view if the diagram is zoomed in or panned away
        var ext = cy.extent(), bb = ele.boundingBox();
        if (bb.x1 < ext.x1 || bb.x2 > ext.x2 || bb.y1 < ext.y1 || bb.y2 > ext.y2) {
          cy.animate({ center: { eles: ele } }, { duration: 200 });
        }
      }
    }

    function back() {
      if (!history.length) return;
      var prev = history.pop();
      select(prev.ele, prev.via, true);
    }

    function onDetailClick(ev) {
      if (ev.target.closest('[data-back]')) return back();
      if (ev.target.closest('a')) return;   // let links inside option text open normally
      var btn = ev.target.closest('[data-go]');
      if (!btn) return;
      var via = btn.getAttribute('data-via');
      select(cy.getElementById(btn.getAttribute('data-go')), via ? cy.getElementById(via) : null);
    }

    var resizeTimer;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sizeToContent, 150);
    }

    // Re-read the colours when the page switches between light and dark mode
    var themeObserver = new MutationObserver(function () {
      theme = readTheme(container);
      cy.style(buildStyle(theme));
    });

    cy.on('tap', 'node', function (ev) { select(ev.target, null); });
    cy.on('tap', 'edge', function (ev) {
      select(ev.target.source(), null);
      focusOption(ev.target);
    });
    cy.on('tap', function (ev) { if (ev.target === cy) select(null); });
    cy.on('mouseover', 'node, edge', function () { container.style.cursor = 'pointer'; });
    cy.on('mouseout', 'node, edge', function () { container.style.cursor = ''; });
    detailEl.addEventListener('click', onDetailClick);
    window.addEventListener('resize', onResize);
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    sizeToContent();
    showDetail(null);

    return {
      cy: cy,
      fit: fit,
      select: function (id) { select(cy.getElementById(id), null); },
      back: back,
      reset: function () {
        history = [];
        select(null, null, true);
        fit();
      },
      zoomBy: function (factor) {
        cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
      },
      destroy: function () {
        detailEl.removeEventListener('click', onDetailClick);
        window.removeEventListener('resize', onResize);
        themeObserver.disconnect();
        cy.destroy();
      }
    };
  }

  global.renderDecisionTree = renderDecisionTree;
})(window);
