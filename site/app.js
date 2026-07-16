(() => {
  "use strict";

  const DATA_URL = "./data/analysis.json";
  const SVG_NS = "http://www.w3.org/2000/svg";
  let radarSequence = 0;
  const state = {
    data: null,
    playersById: new Map(),
    sourcesById: new Map(),
    baseRanking: [],
    scenarios: [],
    selectedPlayerId: null,
    activeScenarioId: null,
    customWeights: {},
    defaultWeights: {},
    compareA: null,
    compareB: null,
    rawPlayerId: null,
    rawRows: [],
    announceTimer: 0,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined && text !== null) item.textContent = String(text);
    return item;
  }

  function clear(node) {
    node.replaceChildren();
  }

  function append(parent, ...children) {
    children.flat().filter(Boolean).forEach((child) => parent.append(child));
    return parent;
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function finite(value, fallback = 0) {
    const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min = 0, max = 100) {
    return Math.min(max, Math.max(min, finite(value)));
  }

  function ratePercent(value) {
    return clamp(finite(value));
  }

  function fmt(value, digits = 1) {
    if (!Number.isFinite(Number(value))) return "—";
    return Number(value).toLocaleString("ko-KR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function fmtCount(value) {
    if (!Number.isFinite(Number(value))) return "—";
    return Math.round(Number(value)).toLocaleString("ko-KR");
  }

  function fmtPercent(value, digits = 1) {
    if (!Number.isFinite(Number(value))) return "—";
    return `${fmt(ratePercent(value), digits)}%`;
  }

  function safeUrl(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value, window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function safeAssetPath(value) {
    if (typeof value !== "string") return null;
    const path = value.trim().replaceAll("\\", "/");
    if (!path || path.startsWith("/") || path.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
    return path;
  }

  function safeObjectPosition(value) {
    return typeof value === "string" && /^(?:100|\d{1,2})% (?:100|\d{1,2})%$/.test(value)
      ? value
      : "50% 35%";
  }

  function playerName(player) {
    return player?.name_ko || player?.name_en || player?.name || player?.id || "이름 미상";
  }

  function initials(player) {
    const name = playerName(player).replace(/\s+/g, "");
    return name.slice(0, 1).toUpperCase();
  }

  function dimensionValue(player, key) {
    const value = player?.dimensions?.[key];
    if (Array.isArray(value)) {
      if (!value.length) return 0;
      return clamp(value.length >= 3 ? value[1] : value.reduce((sum, item) => sum + finite(item), 0) / value.length);
    }
    if (isObject(value)) return clamp(value.score ?? value.value ?? value.normalized);
    return clamp(value);
  }

  function svgElement(tag, attributes = {}, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function radarPoint(index, count, radius, centerX, centerY) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  }

  function radarPoints(dimensions, radius, centerX, centerY, values = null) {
    return dimensions.map((dimension, index) => {
      const scale = values ? clamp(values[dimension.key]) / 100 : 1;
      const point = radarPoint(index, dimensions.length, radius * scale, centerX, centerY);
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    }).join(" ");
  }

  function renderRadarChart(container, series, options = {}) {
    if (!container) return;
    clear(container);
    const dimensions = state.data.methodology.dimensions;
    if (dimensions.length < 3 || !series.length) return;
    const compact = Boolean(options.compact);
    const width = compact ? 100 : 520;
    const height = compact ? 100 : 440;
    const centerX = compact ? 50 : 260;
    const centerY = compact ? 50 : 206;
    const radius = compact ? 41 : 142;
    const id = `radar-${++radarSequence}`;
    const title = series.map((entry) => [entry.roleLabel, playerName(entry.player)].filter(Boolean).join(" ")).join(" 대 ");
    const description = series.map((entry) => {
      const values = dimensions.map((dimension) => `${dimension.label} ${fmt(dimensionValue(entry.player, dimension.key), 0)}점`).join(", ");
      return `${entry.roleLabel ? `${entry.roleLabel} ` : ""}${playerName(entry.player)}: ${values}`;
    }).join(". ");
    const svg = svgElement("svg", {
      class: `radar-svg${compact ? " radar-svg--compact" : ""}`,
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      focusable: "false",
      "aria-labelledby": `${id}-title ${id}-desc`,
    });
    svg.append(
      svgElement("title", { id: `${id}-title` }, `${title} 6차원 기량 레이더`),
      svgElement("desc", { id: `${id}-desc` }, description),
    );

    const grid = svgElement("g", { class: "radar-grid", "aria-hidden": "true" });
    (compact ? [0.5, 1] : [0.25, 0.5, 0.75, 1]).forEach((level) => {
      grid.append(svgElement("polygon", {
        points: radarPoints(dimensions, radius * level, centerX, centerY),
        class: level === 1 ? "radar-ring radar-ring--outer" : "radar-ring",
      }));
    });
    dimensions.forEach((dimension, index) => {
      const end = radarPoint(index, dimensions.length, radius, centerX, centerY);
      grid.append(svgElement("line", {
        x1: centerX,
        y1: centerY,
        x2: end.x,
        y2: end.y,
        class: "radar-axis",
      }));
    });
    svg.append(grid);

    series.forEach((entry, seriesIndex) => {
      const values = Object.fromEntries(dimensions.map((dimension) => [dimension.key, dimensionValue(entry.player, dimension.key)]));
      const className = entry.className || (seriesIndex === 0 ? "radar-series--a" : "radar-series--b");
      const group = svgElement("g", { class: `radar-series ${className}`, "aria-hidden": "true" });
      group.append(svgElement("polygon", {
        points: radarPoints(dimensions, radius, centerX, centerY, values),
        class: "radar-shape",
      }));
      if (!compact) {
        dimensions.forEach((dimension, index) => {
          const point = radarPoint(index, dimensions.length, radius * values[dimension.key] / 100, centerX, centerY);
          if (seriesIndex === 0) {
            group.append(svgElement("circle", { cx: point.x, cy: point.y, r: 4.5, class: "radar-marker" }));
          } else {
            group.append(svgElement("rect", { x: point.x - 4, y: point.y - 4, width: 8, height: 8, class: "radar-marker" }));
          }
        });
      }
      svg.append(group);
    });

    if (!compact) {
      const labels = svgElement("g", { class: "radar-labels", "aria-hidden": "true" });
      dimensions.forEach((dimension, index) => {
        const point = radarPoint(index, dimensions.length, radius + 45, centerX, centerY);
        const anchor = Math.abs(point.x - centerX) < 8 ? "middle" : point.x > centerX ? "start" : "end";
        const label = svgElement("text", {
          x: point.x,
          y: point.y,
          class: "radar-axis-label",
          "text-anchor": anchor,
          "dominant-baseline": "middle",
        });
        label.append(svgElement("tspan", { x: point.x }, dimension.label));
        if (series.length === 1) {
          label.append(svgElement("tspan", { x: point.x, dy: 18, class: "radar-axis-value" }, `${fmt(dimensionValue(series[0].player, dimension.key), 0)}`));
        }
        labels.append(label);
      });
      svg.append(labels);
    }
    container.append(svg);
  }

  function scoreBounds(player) {
    const uncertainty = isObject(player?.uncertainty) ? player.uncertainty : {};
    const score = finite(player?.score ?? uncertainty.median);
    return {
      score,
      low: finite(player?.score_low ?? uncertainty.low, score),
      high: finite(player?.score_high ?? uncertainty.high, score),
    };
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "미기재";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ko-KR", includeTime
      ? { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }
      : { year: "numeric", month: "long", day: "numeric" }).format(date);
  }

  function normalizeWeights(weights) {
    const source = isObject(weights) ? weights : {};
    const entries = state.data.methodology.dimensions.map((dimension) => [
      dimension.key,
      Math.max(0, finite(source[dimension.key])),
    ]);
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    if (total <= 0) return Object.fromEntries(entries.map(([key]) => [key, 0]));
    return Object.fromEntries(entries.map(([key, value]) => [key, (value / total) * 100]));
  }

  function validateAndNormalize(raw) {
    if (!isObject(raw)) throw new Error("분석 데이터의 최상위 값은 객체여야 합니다.");
    if (!isObject(raw.meta)) throw new Error("meta 정보가 없습니다.");
    if (!isObject(raw.methodology)) throw new Error("methodology 정보가 없습니다.");
    if (!Array.isArray(raw.methodology.dimensions) || !raw.methodology.dimensions.length) {
      throw new Error("평가 차원(methodology.dimensions)이 비어 있습니다.");
    }
    if (!Array.isArray(raw.players) || !raw.players.length) {
      throw new Error("후보 선수(players)가 비어 있습니다.");
    }

    const dimensionKeys = new Set();
    raw.methodology.dimensions.forEach((dimension, index) => {
      if (!isObject(dimension) || !dimension.key) throw new Error(`평가 차원 ${index + 1}의 key가 없습니다.`);
      if (dimensionKeys.has(dimension.key)) throw new Error(`평가 차원 key가 중복됩니다: ${dimension.key}`);
      dimensionKeys.add(dimension.key);
    });

    const playerIds = new Set();
    raw.players.forEach((player, index) => {
      if (!isObject(player) || !player.id) throw new Error(`후보 ${index + 1}의 id가 없습니다.`);
      if (playerIds.has(player.id)) throw new Error(`후보 id가 중복됩니다: ${player.id}`);
      if (!isObject(player.dimensions)) throw new Error(`${player.id}의 dimensions가 없습니다.`);
      playerIds.add(player.id);
    });

    const dimensions = raw.methodology.dimensions.map((dimension) => ({
      ...dimension,
      label: dimension.label || dimension.key,
      description: dimension.description || "",
      default_weight: finite(dimension.default_weight),
    }));
    if (dimensions.reduce((sum, dimension) => sum + Math.max(0, dimension.default_weight), 0) <= 0) {
      throw new Error("평가 차원의 기본 가중치 합계가 0입니다.");
    }

    return {
      ...raw,
      methodology: {
        ...raw.methodology,
        dimensions,
        principles: Array.isArray(raw.methodology.principles) ? raw.methodology.principles : [],
        caveats: Array.isArray(raw.methodology.caveats) ? raw.methodology.caveats : [],
      },
      sources: Array.isArray(raw.sources) ? raw.sources : [],
      glossary: Array.isArray(raw.glossary) ? raw.glossary : [],
      pareto_frontier: Array.isArray(raw.pareto_frontier) ? raw.pareto_frontier : [],
      sensitivity: isObject(raw.sensitivity) ? raw.sensitivity : {},
    };
  }

  function createBaseRanking() {
    const rankingInput = Array.isArray(state.data.rankings) && state.data.rankings.length
      ? state.data.rankings
      : state.data.players;
    const rows = rankingInput
      .map((row, index) => {
        const id = row.player_id || row.id;
        const player = state.playersById.get(id);
        if (!player) return null;
        const bounds = scoreBounds(player);
        return {
          player_id: id,
          rank: finite(row.rank, player.rank || index + 1),
          score: finite(row.score, bounds.score),
          score_low: finite(row.score_low, bounds.low),
          score_high: finite(row.score_high, bounds.high),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank || b.score - a.score);
    rows.forEach((row, index) => { row.rank = index + 1; });
    return rows;
  }

  function scenarioLabel(id) {
    const labels = {
      balanced: "균형",
      peak: "정점",
      longevity: "지속성",
      international: "국가대표",
      club: "클럽",
      position_fair: "포지션 보정",
    };
    return labels[id] || id.replaceAll("_", " ");
  }

  function calculateRanking(weights) {
    const normalized = normalizeWeights(weights);
    return state.data.players
      .map((player) => {
        const score = state.data.methodology.dimensions.reduce((sum, dimension) => (
          sum + dimensionValue(player, dimension.key) * (normalized[dimension.key] || 0) / 100
        ), 0);
        return { player_id: player.id, score };
      })
      .sort((a, b) => b.score - a.score || playerName(state.playersById.get(a.player_id)).localeCompare(playerName(state.playersById.get(b.player_id)), "ko"))
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  function normalizeScenarioRanking(scenario) {
    const input = Array.isArray(scenario.ranking) ? scenario.ranking
      : Array.isArray(scenario.rankings) ? scenario.rankings
        : null;
    if (!input?.length) return calculateRanking(scenario.weights || state.defaultWeights);
    return input
      .map((row, index) => {
        const id = typeof row === "string" ? row : row.player_id || row.id;
        if (!state.playersById.has(id)) return null;
        const fallbackScore = state.playersById.get(id).score;
        return {
          player_id: id,
          rank: typeof row === "string" ? index + 1 : finite(row.rank, index + 1),
          score: typeof row === "string" ? finite(fallbackScore) : finite(row.score, fallbackScore),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank || b.score - a.score)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  function createScenarios() {
    const input = state.data.scenarios;
    let entries = [];
    if (Array.isArray(input)) {
      entries = input.map((scenario, index) => [scenario.id || `scenario_${index + 1}`, scenario]);
    } else if (isObject(input)) {
      entries = Object.entries(input);
    }

    const preferred = ["balanced", "peak", "longevity", "international", "club", "position_fair"];
    entries.sort(([a], [b]) => {
      const ia = preferred.indexOf(a);
      const ib = preferred.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    const scenarios = entries.map(([id, value]) => {
      const scenario = isObject(value) ? value : {};
      const normalized = {
        ...scenario,
        id,
        label: scenario.label || scenario.name || scenarioLabel(id),
        description: scenario.description || "",
        weights: isObject(scenario.weights) ? scenario.weights : state.defaultWeights,
      };
      normalized.ranking = normalizeScenarioRanking(normalized);
      normalized.winner = scenario.winner || normalized.ranking[0]?.player_id || null;
      return normalized;
    });

    if (!scenarios.length) {
      const balanced = {
        id: "balanced",
        label: "균형",
        description: state.data.methodology.summary || "",
        weights: state.defaultWeights,
        ranking: state.baseRanking,
        winner: state.baseRanking[0]?.player_id || null,
      };
      scenarios.push(balanced);
    }
    return scenarios;
  }

  function prepareData(raw) {
    state.data = validateAndNormalize(raw);
    state.playersById = new Map(state.data.players.map((player) => [player.id, player]));
    state.sourcesById = new Map(state.data.sources.map((source) => [String(source.id), source]));

    const defaults = Object.fromEntries(state.data.methodology.dimensions.map((dimension) => [
      dimension.key,
      Math.max(0, dimension.default_weight),
    ]));
    const defaultTotal = Object.values(defaults).reduce((sum, value) => sum + value, 0);
    const multiplier = defaultTotal <= 1.01 ? 100 : 1;
    state.defaultWeights = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, value * multiplier]));
    state.customWeights = { ...state.defaultWeights };
    state.baseRanking = createBaseRanking();
    state.scenarios = createScenarios();
    state.selectedPlayerId = state.baseRanking[0]?.player_id || state.data.players[0].id;
    state.activeScenarioId = state.scenarios.find((scenario) => scenario.id === "balanced")?.id || state.scenarios[0].id;
    state.compareA = state.baseRanking[0]?.player_id || state.data.players[0].id;
    state.compareB = state.baseRanking[1]?.player_id || state.data.players.find((player) => player.id !== state.compareA)?.id || state.compareA;
    state.rawPlayerId = state.compareA;
  }

  function setText(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value ?? "";
  }

  function makePlayerSigil(player) {
    const sigil = element("span", "player-sigil");
    sigil.setAttribute("aria-hidden", "true");
    const assetPath = safeAssetPath(player?.photo?.asset_path);
    if (assetPath) {
      const image = element("img");
      image.src = `./${assetPath}`;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.width = 96;
      image.height = 96;
      image.style.setProperty("--photo-position", safeObjectPosition(player.photo.object_position));
      sigil.classList.add("has-photo");
      sigil.append(image);
    } else {
      sigil.textContent = initials(player);
      sigil.classList.add("has-fallback");
    }
    return sigil;
  }

  function robustWinRate(player) {
    if (player.robust_win_rate !== undefined) return ratePercent(player.robust_win_rate);
    const wins = probabilityEntries(state.data.sensitivity.wins || state.data.sensitivity.win_rate);
    return wins.find((entry) => entry.player_id === player.id)?.rate ?? 0;
  }

  function rankStability(player) {
    if (player.rank_stability !== undefined) return ratePercent(player.rank_stability);
    const uncertainty = isObject(player.uncertainty) ? player.uncertainty : {};
    return ratePercent(uncertainty.rank_probability || uncertainty.rank_stability || 0);
  }

  function renderMetaAndHero() {
    const { meta } = state.data;
    const finding = isObject(state.data.finding) ? state.data.finding : {};
    const top = state.baseRanking[0];
    const second = state.baseRanking[1];
    const winner = state.playersById.get(top.player_id);
    const candidateCount = finite(meta.candidate_count, state.data.players.length);
    const asOf = formatDate(meta.as_of);

    document.title = `${meta.title || "축구 GOAT 분석 보고서"} · GOAT INDEX`;
    setText("#report-title", meta.title || "축구 역대 최고 선수는 누구인가");
    setText("#report-subtitle", meta.subtitle || "");
    setText("#as-of-label", `데이터 기준 ${asOf}`);
    setText("#coverage-note", meta.coverage_note || "");
    setText("#header-edition", `${meta.method_version || "분석판"} · ${meta.as_of || ""}`);
    setText("#winner-name", playerName(winner));
    setText("#winner-context", [winner.country, winner.era, winner.position].filter(Boolean).join(" · "));
    setText("#winner-score", fmt(top.score));
    $("#winner-score").dataset.numberTarget = String(top.score);
    setText("#winner-interval", `${fmt(top.score_low)}–${fmt(top.score_high)}`);
    setText("#snapshot-candidates", fmtCount(candidateCount));
    setText("#snapshot-dimensions", fmtCount(state.data.methodology.dimensions.length));
    setText("#snapshot-iterations", fmtCount(meta.iterations));
    setText("#snapshot-version", meta.method_version || "—");
    const winnerPortrait = $("#winner-portrait");
    clear(winnerPortrait);
    const heroSigil = makePlayerSigil(winner);
    heroSigil.classList.add("player-sigil--hero");
    const heroImage = $("img", heroSigil);
    if (heroImage) heroImage.loading = "eager";
    winnerPortrait.append(heroSigil);
    renderRadarChart($("#winner-radar"), [{ player: winner, className: "radar-series--a" }], { compact: true });

    const overlaps = second ? top.score_low <= second.score_high && second.score_low <= top.score_high : false;
    setText("#verdict-title", finding.label || "가장 높은 종합 점수");
    let reading = finding.interpretation || `${playerName(winner)}이 균형 모델에서 가장 높은 중앙 추정치를 기록했습니다.`;
    if (!finding.interpretation && second && overlaps) {
      reading += ` 다만 ${playerName(state.playersById.get(second.player_id))}과 불확실성 구간이 겹치므로, 단독 정답이 아니라 현재 기준의 선두로 읽어야 합니다.`;
    } else if (!finding.interpretation && second) {
      reading += ` 2위와의 중앙값 차이는 ${fmt(top.score - second.score)}점이지만, 가치 가중치가 바뀌면 순위도 움직일 수 있습니다.`;
    }
    setText("#verdict-reading", reading);

    const footerAsOf = $("#footer-as-of");
    const footerGenerated = $("#footer-generated");
    footerAsOf.textContent = asOf;
    footerAsOf.dateTime = meta.as_of || "";
    footerGenerated.textContent = formatDate(meta.generated_at, true);
    footerGenerated.dateTime = meta.generated_at || "";
  }

  function insightCard(index, title, body, stat, unit) {
    const card = element("article", "insight-card");
    card.dataset.index = String(index).padStart(2, "0");
    append(card, element("h3", "", title), element("p", "", body));
    const metric = element("div", "insight-stat");
    append(metric, element("strong", "", stat), element("span", "", unit));
    card.append(metric);
    return card;
  }

  function renderExecutiveInsights() {
    const container = $("#executive-insights");
    clear(container);
    const suppliedFindings = Array.isArray(state.data.findings)
      ? state.data.findings
      : Array.isArray(state.data.finding)
        ? state.data.finding
        : [];
    if (suppliedFindings.length >= 3) {
      suppliedFindings.slice(0, 3).forEach((finding, index) => {
        const item = isObject(finding) ? finding : { title: String(finding) };
        container.append(insightCard(
          index + 1,
          item.title || item.headline || `핵심 발견 ${index + 1}`,
          item.body || item.description || item.interpretation || "",
          formatRawValue(item.value ?? item.stat ?? item.metric),
          item.unit || item.label || "분석 결과",
        ));
      });
      return;
    }
    const top = state.baseRanking[0];
    const second = state.baseRanking[1];
    const winner = state.playersById.get(top.player_id);
    const finding = isObject(state.data.finding) ? state.data.finding : {};
    const gap = second ? top.score - second.score : 0;
    const winners = new Set(state.scenarios.map((scenario) => scenario.winner).filter(Boolean));
    const winRate = robustWinRate(winner);
    const overlap = second && top.score_low <= second.score_high;

    append(container,
      insightCard(1, finding.headline || (overlap ? "선두는 있지만 통계적 단독 승자는 아니다" : "균형 모델의 선두가 분명하다"),
        finding.interpretation || (overlap
          ? `1위와 2위의 추정 구간이 겹칩니다. ${fmt(gap)}점의 중앙값 차이를 확정적 격차로 해석하지 않았습니다.`
          : `1위와 2위의 중앙값 격차는 ${fmt(gap)}점입니다. 그래도 다른 가치 기준의 결과를 함께 확인해야 합니다.`),
        fmt(gap), "1·2위 점수 차"),
      insightCard(2, "‘위대함’의 정의가 결론에 개입한다",
        "정점, 지속성, 국가대표, 클럽, 포지션 공정성의 우선순위를 바꿔 모델 의존성을 점검했습니다.",
        fmtCount(winners.size), "시나리오별 서로 다른 1위"),
      insightCard(3, "강건성은 점수와 다른 질문에 답한다",
        `${playerName(winner)}의 1위 도달률은 가중치와 입력을 흔든 반복 모형에서 얻은 값입니다.`,
        fmt(winRate), "% 반복에서 1위"),
    );
  }

  function populateFilters() {
    const position = $("#position-filter");
    const era = $("#era-filter");
    const positionLabels = {
      attack: "공격수",
      midfield: "미드필더",
      defence: "수비수",
      goalkeeper: "골키퍼",
    };
    const positions = [...new Set(state.data.players.map((player) => player.position_group || player.position).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), "ko"));
    const eras = [...new Set(state.data.players.map((player) => player.era).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), "ko"));
    positions.forEach((value) => {
      const option = element("option", "", positionLabels[value] || value);
      option.value = value;
      position.append(option);
    });
    eras.forEach((value) => {
      const option = element("option", "", value);
      option.value = value;
      era.append(option);
    });
  }

  function intervalChart(row, player) {
    const wrapper = element("div", "interval-wrap");
    const chart = element("div", "interval-chart");
    const low = clamp(row.score_low);
    const high = clamp(row.score_high);
    const point = clamp(row.score);
    const band = element("span", "interval-band");
    band.style.setProperty("--left", `${low}%`);
    band.style.setProperty("--width", `${Math.max(0, high - low)}%`);
    const dot = element("span", "interval-point");
    dot.style.setProperty("--point", `${point}%`);
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", `${playerName(player)} 점수 ${fmt(point)}, 불확실성 구간 ${fmt(low)}에서 ${fmt(high)}`);
    append(chart, band, dot);
    append(wrapper, chart, element("span", "interval-label", `${fmt(low)}–${fmt(high)}`));
    return wrapper;
  }

  function currentFilteredRanking() {
    const search = $("#ranking-search").value.trim().toLocaleLowerCase("ko");
    const position = $("#position-filter").value;
    const era = $("#era-filter").value;
    return state.baseRanking.filter((row) => {
      const player = state.playersById.get(row.player_id);
      const haystack = [playerName(player), player.name_en, player.country, player.position, player.position_group, player.era]
        .filter(Boolean).join(" ").toLocaleLowerCase("ko");
      const positionValue = player.position_group || player.position;
      return (!search || haystack.includes(search))
        && (position === "all" || positionValue === position)
        && (era === "all" || player.era === era);
    });
  }

  function renderRanking() {
    const body = $("#ranking-body");
    const rows = currentFilteredRanking();
    clear(body);
    const pareto = new Set(state.data.pareto_frontier);
    rows.forEach((row) => {
      const player = state.playersById.get(row.player_id);
      const tr = element("tr", row.player_id === state.selectedPlayerId ? "is-selected" : "");
      tr.dataset.playerId = row.player_id;

      const rank = element("td");
      rank.append(element("span", "rank-number", row.rank));

      const playerTd = element("td");
      const playerCell = element("div", "player-cell");
      const names = element("div");
      const strong = element("strong", "", playerName(player));
      if (pareto.has(player.id)) strong.append(element("span", "pareto-badge", "PARETO"));
      append(names, strong, element("small", "", player.name_en && player.name_en !== playerName(player) ? player.name_en : player.country || ""));
      append(playerCell, makePlayerSigil(player), names);
      playerTd.append(playerCell);

      const context = element("td", "context-cell");
      append(context, element("span", "", player.position || player.position_group || "—"), element("small", "", player.era || "시대 미기재"));

      const radar = element("td", "radar-cell");
      renderRadarChart(radar, [{ player, className: "radar-series--a" }], { compact: true });

      const score = element("td", "score-cell");
      append(score, element("strong", "", fmt(row.score)), element("small", "", "/ 100"));

      const interval = element("td");
      interval.append(intervalChart(row, player));

      const robust = element("td", "robust-cell");
      const robustValue = robustWinRate(player);
      robust.append(element("span", "", fmtPercent(robustValue)));
      const meter = element("div", "mini-meter");
      const meterFill = element("span");
      meterFill.style.setProperty("--value", `${robustValue}%`);
      meter.append(meterFill);
      robust.append(meter);

      const action = element("td");
      const button = element("button", "row-button", "분석");
      button.type = "button";
      button.dataset.playerId = player.id;
      button.setAttribute("aria-label", `${playerName(player)} 상세 프로필 보기`);
      button.setAttribute("aria-pressed", String(player.id === state.selectedPlayerId));
      action.append(button);

      append(tr, rank, playerTd, context, radar, score, interval, robust, action);
      body.append(tr);
    });
    $("#ranking-empty").hidden = rows.length > 0;
    setText("#ranking-count", `${rows.length} / ${state.baseRanking.length}명 표시`);
  }

  function renderDimensionBars(container, player) {
    clear(container);
    state.data.methodology.dimensions.forEach((dimension) => {
      const value = dimensionValue(player, dimension.key);
      const row = element("div", "dimension-row");
      const label = element("span", "", dimension.label);
      const track = element("div", "dimension-track");
      const fill = element("span");
      fill.style.setProperty("--value", `${value}%`);
      track.append(fill);
      track.setAttribute("role", "img");
      track.setAttribute("aria-label", `${dimension.label} ${fmt(value)}점`);
      append(row, label, track, element("strong", "", fmt(value, 0)));
      container.append(row);
    });
  }

  function renderEvidenceNote(player) {
    const parts = [];
    if (player.evidence_note) parts.push(String(player.evidence_note));
    if (isObject(player.evidence)) {
      if (player.evidence.coverage_grade) parts.push(`근거 커버리지 ${player.evidence.coverage_grade}`);
      if (player.evidence.source_conflicts) {
        const conflicts = Array.isArray(player.evidence.source_conflicts)
          ? player.evidence.source_conflicts.join(", ")
          : String(player.evidence.source_conflicts);
        parts.push(`출처 충돌: ${conflicts}`);
      }
    }
    if (player.confidence !== undefined) {
      const confidence = typeof player.confidence === "number" ? fmtPercent(player.confidence) : formatRawValue(player.confidence);
      parts.push(`신뢰도 ${confidence}`);
    }
    return parts.join(" · ");
  }

  function renderCaseList(selector, items) {
    const list = $(selector);
    clear(list);
    const values = Array.isArray(items) ? [...items] : [];
    if (!values.length) values.push("데이터에 별도 근거 메모가 등록되지 않았습니다.");
    values.forEach((item) => list.append(element("li", "", isObject(item) ? item.text || item.claim || JSON.stringify(item) : item)));
  }

  function renderDossier() {
    const player = state.playersById.get(state.selectedPlayerId);
    if (!player) return;
    const rank = state.baseRanking.find((row) => row.player_id === player.id);
    setText("#dossier-name", playerName(player));
    setText("#dossier-meta", [player.name_en && player.name_en !== playerName(player) ? player.name_en : null, player.country, player.era, player.position].filter(Boolean).join(" · "));
    setText("#dossier-rank", rank ? `#${rank.rank}` : "—");
    const portrait = $("#dossier-portrait");
    clear(portrait);
    const dossierSigil = makePlayerSigil(player);
    dossierSigil.classList.add("player-sigil--dossier");
    portrait.append(dossierSigil);
    renderRadarChart($("#dossier-radar"), [{ player, className: "radar-series--a" }]);
    renderDimensionBars($("#dossier-dimensions"), player);
    renderCaseList("#case-for", player.case_for);
    renderCaseList("#case-against", player.case_against);
    setText("#evidence-note", renderEvidenceNote(player) || "근거 메모가 별도로 등록되지 않았습니다.");
  }

  function selectPlayer(playerId, scroll = false) {
    if (!state.playersById.has(playerId)) return;
    state.selectedPlayerId = playerId;
    renderRanking();
    renderDossier();
    announce(`${playerName(state.playersById.get(playerId))} 상세 프로필을 표시했습니다.`);
    if (scroll) {
      const heading = $("#dossier-name");
      heading.focus({ preventScroll: true });
      $("#player-dossier").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  }

  function renderScenarioTabs() {
    const tabs = $("#scenario-tabs");
    clear(tabs);
    state.scenarios.forEach((scenario) => {
      const button = element("button", "scenario-tab", scenario.label);
      button.type = "button";
      button.id = `scenario-tab-${scenario.id}`;
      button.dataset.scenarioId = scenario.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "scenario-panel");
      button.setAttribute("aria-selected", String(scenario.id === state.activeScenarioId));
      button.tabIndex = scenario.id === state.activeScenarioId ? 0 : -1;
      tabs.append(button);
    });
    renderScenarioPanel();
  }

  function renderScenarioPanel() {
    const scenario = state.scenarios.find((item) => item.id === state.activeScenarioId) || state.scenarios[0];
    if (!scenario) return;
    $$(".scenario-tab").forEach((tab) => {
      const selected = tab.dataset.scenarioId === scenario.id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    $("#scenario-panel").setAttribute("aria-labelledby", `scenario-tab-${scenario.id}`);
    const winnerId = scenario.winner || scenario.ranking[0]?.player_id;
    const winner = state.playersById.get(winnerId);
    const baseRank = state.baseRanking.find((row) => row.player_id === winnerId)?.rank;
    const scenarioRank = scenario.ranking.find((row) => row.player_id === winnerId)?.rank || 1;
    const move = baseRank ? baseRank - scenarioRank : 0;

    setText("#scenario-label", `${scenario.label} 시나리오의 1위`);
    setText("#scenario-winner", playerName(winner));
    setText("#scenario-description", scenario.description || state.data.methodology.summary || "");
    const shift = $("#scenario-shift");
    clear(shift);
    append(shift,
      element("strong", "", move > 0 ? `▲ ${move}계단` : move < 0 ? `▼ ${Math.abs(move)}계단` : "변동 없음"),
      element("span", "", "균형 모델의 해당 선수 순위 대비"),
    );

    const ranking = $("#scenario-ranking");
    clear(ranking);
    scenario.ranking.slice(0, 8).forEach((row) => {
      const player = state.playersById.get(row.player_id);
      const baseline = state.baseRanking.find((item) => item.player_id === row.player_id)?.rank;
      const change = baseline ? baseline - row.rank : 0;
      const li = element("li");
      const changeText = change > 0 ? `▲ ${change}` : change < 0 ? `▼ ${Math.abs(change)}` : "—";
      const changeNode = element("span", `rank-change ${change > 0 ? "rank-up" : change < 0 ? "rank-down" : ""}`, changeText);
      append(li, element("strong", "", playerName(player)), element("span", "", fmt(row.score)), changeNode);
      ranking.append(li);
    });

    const weights = normalizeWeights(scenario.weights);
    const composition = $("#scenario-weights");
    clear(composition);
    state.data.methodology.dimensions.forEach((dimension) => {
      const value = weights[dimension.key] || 0;
      const row = element("div", "composition-row");
      const track = element("div", "composition-track");
      const fill = element("i");
      fill.style.setProperty("--value", `${value}%`);
      track.append(fill);
      append(row, element("span", "", dimension.label), track, element("strong", "", `${fmt(value, 0)}%`));
      composition.append(row);
    });
  }

  function activateScenario(id, focus = false) {
    if (!state.scenarios.some((scenario) => scenario.id === id)) return;
    state.activeScenarioId = id;
    renderScenarioPanel();
    const tab = $(`.scenario-tab[data-scenario-id="${CSS.escape(id)}"]`);
    if (focus) tab?.focus();
    announce(`${state.scenarios.find((scenario) => scenario.id === id).label} 시나리오를 표시했습니다.`);
  }

  function renderWeightSliders() {
    const container = $("#weight-sliders");
    clear(container);
    const normalized = normalizeWeights(state.customWeights);
    state.data.methodology.dimensions.forEach((dimension) => {
      const row = element("div", "slider-row");
      const label = element("label", "slider-label");
      label.htmlFor = `weight-${dimension.key}`;
      append(label, element("strong", "", dimension.label), element("span", "", dimension.description));
      const input = element("input");
      input.type = "range";
      input.id = `weight-${dimension.key}`;
      input.name = dimension.key;
      input.min = "0";
      input.max = "100";
      input.step = "1";
      input.value = String(clamp(state.customWeights[dimension.key]));
      input.setAttribute("aria-describedby", "weight-help");
      input.style.setProperty("--range-progress", `${input.value}%`);
      const output = element("output", "slider-value", `${fmt(normalized[dimension.key], 1)}%`);
      output.htmlFor = input.id;
      output.id = `weight-output-${dimension.key}`;
      append(row, label, input, output);
      container.append(row);
    });
    renderCustomRanking(false);
  }

  function renderCustomRanking(shouldAnnounce = true) {
    const normalized = normalizeWeights(state.customWeights);
    const ranking = calculateRanking(state.customWeights);
    const winner = state.playersById.get(ranking[0]?.player_id);
    state.data.methodology.dimensions.forEach((dimension) => {
      const output = $(`#weight-output-${CSS.escape(dimension.key)}`);
      if (output) output.textContent = `${fmt(normalized[dimension.key], 1)}%`;
      const input = $(`#weight-${CSS.escape(dimension.key)}`);
      if (input) {
        input.style.setProperty("--range-progress", `${input.value}%`);
        input.setAttribute("aria-valuetext", `원시값 ${fmt(finite(input.value), 0)}, 정규화 ${fmt(normalized[dimension.key], 1)}퍼센트`);
      }
    });
    setText("#normalized-total", "100%");
    setText("#custom-winner-name", playerName(winner));
    setText("#custom-winner-score", fmt(ranking[0]?.score));
    const list = $("#custom-ranking");
    clear(list);
    ranking.slice(0, 8).forEach((row) => {
      const li = element("li");
      append(li, element("strong", "", playerName(state.playersById.get(row.player_id))), element("span", "", fmt(row.score)));
      list.append(li);
    });
    if (shouldAnnounce) announce(`가중치 재계산 결과 1위는 ${playerName(winner)}, ${fmt(ranking[0]?.score)}점입니다.`, true);
  }

  function populatePlayerSelect(select, selectedId) {
    clear(select);
    state.baseRanking.forEach((row) => {
      const player = state.playersById.get(row.player_id);
      const option = element("option", "", `${row.rank}. ${playerName(player)}`);
      option.value = player.id;
      option.selected = player.id === selectedId;
      select.append(option);
    });
  }

  function renderCompare() {
    const playerA = state.playersById.get(state.compareA);
    const playerB = state.playersById.get(state.compareB);
    if (!playerA || !playerB) return;
    $("#compare-a").value = playerA.id;
    $("#compare-b").value = playerB.id;
    const summary = $("#compare-summary");
    clear(summary);
    const card = (player) => {
      const bounds = scoreBounds(player);
      const node = element("article", "compare-card");
      const identity = element("div", "compare-identity");
      const copy = element("div");
      append(copy,
        element("p", "", [player.country, player.era, player.position].filter(Boolean).join(" · ")),
        element("h3", "", playerName(player)),
      );
      append(identity, makePlayerSigil(player), copy);
      append(node,
        identity,
        element("span", "compare-score", fmt(bounds.score)),
        element("p", "", `불확실성 ${fmt(bounds.low)}–${fmt(bounds.high)} · 1위 도달률 ${fmtPercent(robustWinRate(player))}`),
      );
      return node;
    };
    append(summary, card(playerA), element("div", "compare-divider"), card(playerB));
    renderRadarChart($("#compare-radar"), [
      { player: playerA, className: "radar-series--a", roleLabel: "후보 A" },
      { player: playerB, className: "radar-series--b", roleLabel: "후보 B" },
    ]);

    const chart = $("#compare-chart");
    clear(chart);
    state.data.methodology.dimensions.forEach((dimension) => {
      const a = dimensionValue(playerA, dimension.key);
      const b = dimensionValue(playerB, dimension.key);
      const row = element("div", "compare-row");
      const left = element("div", "compare-side is-reverse");
      const leftTrack = element("div", "compare-bar-track");
      const leftFill = element("i");
      leftFill.style.setProperty("--value", `${a}%`);
      leftFill.classList.add("series-a");
      leftTrack.append(leftFill);
      append(left, leftTrack, element("strong", "", fmt(a, 0)));
      const right = element("div", "compare-side");
      const rightTrack = element("div", "compare-bar-track");
      const rightFill = element("i");
      rightFill.style.setProperty("--value", `${b}%`);
      rightFill.classList.add("series-b");
      rightTrack.append(rightFill);
      append(right, element("strong", "", fmt(b, 0)), rightTrack);
      append(row, left, element("div", "compare-row-label", dimension.label), right);
      row.setAttribute("aria-label", `${dimension.label}: ${playerName(playerA)} ${fmt(a)}, ${playerName(playerB)} ${fmt(b)}`);
      chart.append(row);
    });
    setText("#legend-a", playerName(playerA));
    setText("#legend-b", playerName(playerB));
  }

  function probabilityEntries(input) {
    if (Array.isArray(input)) {
      return input.map((entry) => ({
        player_id: entry.player_id || entry.id,
        rate: ratePercent(entry.rate ?? entry.probability ?? entry.value),
      })).filter((entry) => state.playersById.has(entry.player_id));
    }
    if (isObject(input)) {
      return Object.entries(input).map(([player_id, value]) => ({
        player_id,
        rate: ratePercent(isObject(value) ? value.rate ?? value.probability ?? value.value : value),
      })).filter((entry) => state.playersById.has(entry.player_id));
    }
    return [];
  }

  function renderProbabilityList(container, entries, seriesClass) {
    clear(container);
    entries.sort((a, b) => b.rate - a.rate).slice(0, 10).forEach((entry) => {
      const player = state.playersById.get(entry.player_id);
      const row = element("div", "probability-row");
      const track = element("div", "probability-track");
      const fill = element("i");
      fill.style.setProperty("--value", `${entry.rate}%`);
      fill.classList.add(seriesClass);
      track.append(fill);
      track.setAttribute("role", "img");
      track.setAttribute("aria-label", `${playerName(player)} ${fmtPercent(entry.rate)}`);
      append(row, element("span", "", playerName(player)), track, element("strong", "", fmtPercent(entry.rate)));
      container.append(row);
    });
    if (!entries.length) container.append(element("p", "empty-message", "민감도 데이터가 제공되지 않았습니다."));
  }

  function renderRobustness() {
    let wins = probabilityEntries(state.data.sensitivity.wins || state.data.sensitivity.win_rate);
    if (!wins.length) wins = state.data.players.map((player) => ({ player_id: player.id, rate: robustWinRate(player) }));
    let top3 = probabilityEntries(state.data.sensitivity.top3 || state.data.sensitivity.top_three);
    if (!top3.length) top3 = state.data.players.map((player) => ({ player_id: player.id, rate: rankStability(player) }));
    const strongest = [...wins].sort((a, b) => b.rate - a.rate)[0];
    const distinctWinners = new Set(state.scenarios.map((scenario) => scenario.winner).filter(Boolean)).size;
    const top = state.baseRanking[0];
    const second = state.baseRanking[1];
    const overview = $("#robust-overview");
    clear(overview);
    const stat = (label, value, body) => {
      const item = element("article", "robust-stat");
      append(item, element("span", "", label), element("strong", "", value), element("p", "", body));
      return item;
    };
    append(overview,
      stat("가장 높은 1위 도달률", strongest ? fmtPercent(strongest.rate) : "—", strongest ? playerName(state.playersById.get(strongest.player_id)) : "민감도 데이터 없음"),
      stat("균형 모델 1·2위 격차", second ? `${fmt(top.score - second.score)}점` : "—", "중앙 추정치 기준이며 구간 중첩을 함께 확인해야 합니다."),
      stat("시나리오별 서로 다른 1위", `${distinctWinners}명`, `${state.scenarios.length}개 가치 시나리오에서 관찰된 결과입니다.`),
    );
    renderProbabilityList($("#win-probabilities"), wins, "series-a");
    renderProbabilityList($("#top3-probabilities"), top3, "series-b");

    const pareto = $("#pareto-names");
    clear(pareto);
    state.data.pareto_frontier.forEach((id) => {
      const player = state.playersById.get(id);
      if (player) pareto.append(element("span", "pareto-name", playerName(player)));
    });
    if (!pareto.children.length) pareto.append(element("span", "pareto-name", "파레토 데이터 없음"));
  }

  function humanizeKey(key) {
    const labels = {
      appearances: "출전",
      matches: "경기 수",
      minutes: "출전 시간",
      goals: "득점",
      assists: "도움",
      goals_per_90: "90분당 득점",
      assists_per_90: "90분당 도움",
      goal_contributions: "공격 포인트",
      clean_sheets: "클린시트",
      saves: "선방",
      trophies: "우승",
      club_trophies: "클럽 우승",
      international_trophies: "국가대표 우승",
      league_titles: "리그 우승",
      champions_league_titles: "유럽 챔피언스리그 우승",
      world_cup_titles: "월드컵 우승",
      ballon_dor: "발롱도르",
      major_awards: "주요 개인상",
      peak_seasons: "정점 시즌",
      career_years: "선수 경력",
      elo_adjusted_win_impact: "Elo 보정 승리 기여",
    };
    return labels[key] || String(key).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function formatRawValue(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("ko-KR") : fmt(value, 2);
    if (typeof value === "boolean") return value ? "예" : "아니요";
    if (Array.isArray(value)) return value.map(formatRawValue).join(", ");
    if (isObject(value)) return value.label || value.name || JSON.stringify(value);
    return String(value);
  }

  function rawValueObject(raw) {
    if (isObject(raw) && ("value" in raw || "unit" in raw || "source_id" in raw || "scope" in raw)) return raw;
    return { value: raw };
  }

  function rawSourceIds(item) {
    const input = item.source_ids ?? item.source_id ?? item.sources ?? item.source;
    if (Array.isArray(input)) return input.map(String);
    if (input === null || input === undefined || input === "") return [];
    return [String(input)];
  }

  function rawRowsFor(player) {
    if (!isObject(player.raw_stats)) return [];
    return Object.entries(player.raw_stats).map(([key, raw]) => {
      const item = { ...rawValueObject(raw) };
      if (!rawSourceIds(item).length && Array.isArray(player.source_ids)) item.source_ids = [...player.source_ids];
      return { key, label: humanizeKey(key), item };
    });
  }

  function renderRawData() {
    const player = state.playersById.get(state.rawPlayerId);
    if (!player) return;
    $("#raw-player").value = player.id;
    const search = $("#raw-search").value.trim().toLocaleLowerCase("ko");
    const allRows = rawRowsFor(player);
    const rows = allRows.filter((row) => !search || `${row.label} ${row.key}`.toLocaleLowerCase("ko").includes(search));
    state.rawRows = rows;
    const body = $("#raw-body");
    clear(body);
    setText("#raw-caption", `${playerName(player)}의 원자료`);

    rows.forEach(({ label, item }) => {
      const tr = element("tr");
      const name = element("td", "", label);
      const value = element("td", "", formatRawValue(item.value));
      const scopeUnit = element("td", "raw-meta", [item.scope, item.unit].filter(Boolean).join(" · ") || "—");
      const coverage = element("td", "raw-meta");
      coverage.append(document.createTextNode(formatRawValue(item.coverage)));
      if (item.confidence !== undefined) coverage.append(element("span", "confidence-chip", `신뢰도 ${formatRawValue(item.confidence)}`));
      const source = element("td");
      const sourceIds = rawSourceIds(item);
      if (!sourceIds.length) {
        source.textContent = "—";
      } else {
        sourceIds.forEach((id, index) => {
          if (index) source.append(document.createTextNode(", "));
          const known = state.sourcesById.get(id);
          const link = element("a", "source-ref", known?.publisher || known?.title || id);
          link.href = `#source-${encodeURIComponent(id)}`;
          source.append(link);
        });
      }
      append(tr, name, value, scopeUnit, coverage, source);
      body.append(tr);
    });
    $("#raw-empty").hidden = rows.length > 0;
    $("#download-csv").disabled = !rows.length;
  }

  function renderMethodology() {
    setText("#method-summary", state.data.methodology.summary || "");
    const principles = $("#principle-list");
    clear(principles);
    state.data.methodology.principles.forEach((principle) => principles.append(element("li", "", isObject(principle) ? principle.text || principle.label || JSON.stringify(principle) : principle)));
    if (!principles.children.length) principles.append(element("li", "", "분석 원칙이 데이터에 기재되지 않았습니다."));

    const definitions = $("#dimension-definitions");
    clear(definitions);
    const normalized = normalizeWeights(state.defaultWeights);
    state.data.methodology.dimensions.forEach((dimension) => {
      const card = element("article", "dimension-definition");
      const heading = element("h4");
      append(heading, document.createTextNode(dimension.label), element("span", "", `기본 ${fmt(normalized[dimension.key], 1)}%`));
      append(card, heading, element("p", "", dimension.description || "설명 미기재"));
      definitions.append(card);
    });

    const glossary = $("#glossary-list");
    clear(glossary);
    state.data.glossary.forEach((entry) => {
      append(glossary, element("dt", "", entry.term || ""), element("dd", "", entry.definition || ""));
    });
    $(".glossary").hidden = !state.data.glossary.length;

    renderCaseList("#caveat-list", state.data.methodology.caveats);
  }

  function renderSources() {
    const credits = $("#photo-credit-list");
    clear(credits);
    const media = Array.isArray(state.data.media) ? state.data.media : [];
    media.forEach((entry) => {
      const player = state.playersById.get(entry.player_id);
      const item = element("li", "photo-credit-item");
      const portrait = player ? makePlayerSigil(player) : element("span", "player-sigil has-fallback", "?");
      portrait.classList.add("player-sigil--credit");
      const copy = element("div");
      append(copy,
        element("strong", "", player ? playerName(player) : entry.player_id || "선수"),
        element("span", "", entry.author || "작가 미기재"),
      );
      const links = element("div", "photo-credit-links");
      const licenseUrl = safeUrl(entry.license_url);
      const sourceUrl = safeUrl(entry.source_url);
      if (licenseUrl) {
        const license = element("a", "", entry.license || "라이선스");
        license.href = licenseUrl;
        license.target = "_blank";
        license.rel = "license noopener noreferrer";
        links.append(license);
      }
      if (sourceUrl) {
        const original = element("a", "", "원본 ↗");
        original.href = sourceUrl;
        original.target = "_blank";
        original.rel = "noopener noreferrer";
        original.setAttribute("aria-label", `${player ? playerName(player) : "선수"} 사진 원본 파일 새 창에서 열기`);
        links.append(original);
      }
      append(item, portrait, copy, links);
      credits.append(item);
    });
    if (!media.length) credits.append(element("li", "empty-message", "사진 크레딧이 데이터에 포함되지 않았습니다."));

    const list = $("#source-list");
    clear(list);
    state.data.sources.forEach((source) => {
      const item = element("li", "source-item");
      item.id = `source-${source.id}`;
      append(item,
        element("strong", "", source.title || source.id || "출처"),
        element("span", "", [source.publisher, source.accessed ? `열람 ${formatDate(source.accessed)}` : null].filter(Boolean).join(" · ")),
        element("p", "", source.scope || "범위 미기재"),
      );
      const url = safeUrl(source.url);
      if (url) {
        const link = element("a", "", "↗");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `${source.title || source.publisher || "출처"} 새 창에서 열기`);
        item.append(link);
      } else {
        item.append(element("span", "", ""));
      }
      list.append(item);
    });
    if (!state.data.sources.length) list.append(element("li", "empty-message", "출처 목록이 데이터에 포함되지 않았습니다."));
  }

  function renderAll() {
    renderMetaAndHero();
    renderExecutiveInsights();
    populateFilters();
    renderRanking();
    renderDossier();
    renderScenarioTabs();
    renderWeightSliders();
    populatePlayerSelect($("#compare-a"), state.compareA);
    populatePlayerSelect($("#compare-b"), state.compareB);
    renderCompare();
    renderRobustness();
    populatePlayerSelect($("#raw-player"), state.rawPlayerId);
    renderRawData();
    renderMethodology();
    renderSources();
  }

  function announce(message, debounce = false) {
    const live = $("#live-region");
    window.clearTimeout(state.announceTimer);
    const write = () => {
      live.textContent = "";
      requestAnimationFrame(() => { live.textContent = message; });
    };
    if (debounce) state.announceTimer = window.setTimeout(write, 350);
    else write();
  }

  function revealHeroScore() {
    const node = $("#winner-score");
    const target = finite(node?.dataset.numberTarget, NaN);
    if (!node || !Number.isFinite(target) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (node && Number.isFinite(target)) node.textContent = fmt(target);
      return;
    }
    const duration = 900;
    const started = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 4;
      node.textContent = fmt(target * eased);
      if (progress < 1) requestAnimationFrame(step);
      else node.textContent = fmt(target);
    };
    requestAnimationFrame(step);
  }

  function downloadRawCsv() {
    const player = state.playersById.get(state.rawPlayerId);
    if (!player || !state.rawRows.length) return;
    const rows = [["지표", "값", "단위", "범위", "커버리지", "신뢰도", "출처"]];
    state.rawRows.forEach(({ label, item }) => {
      rows.push([
        label,
        formatRawValue(item.value),
        formatRawValue(item.unit),
        formatRawValue(item.scope),
        formatRawValue(item.coverage),
        formatRawValue(item.confidence),
        rawSourceIds(item).join(" | "),
      ]);
    });
    const csvCell = (value) => {
      let string = String(value ?? "");
      if (/^[=+\-@]/.test(string)) string = `'${string}`;
      return `"${string.replaceAll('"', '""')}"`;
    };
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${player.id}-raw-stats.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    announce(`${playerName(player)} 원자료 CSV를 저장했습니다.`);
  }

  function bindEvents() {
    const mobileNav = $(".mobile-nav");
    const mobileNavSummary = $("summary", mobileNav);
    mobileNav?.addEventListener("toggle", () => {
      mobileNavSummary?.setAttribute("aria-expanded", String(mobileNav.open));
      mobileNavSummary?.setAttribute("aria-label", mobileNav.open ? "보고서 목차 닫기" : "보고서 목차 열기");
    });
    $$("nav a", mobileNav).forEach((link) => link.addEventListener("click", () => {
      mobileNav.open = false;
    }));
    $("#ranking-search").addEventListener("input", renderRanking);
    $("#position-filter").addEventListener("change", renderRanking);
    $("#era-filter").addEventListener("change", renderRanking);
    $("#clear-filters").addEventListener("click", () => {
      $("#ranking-search").value = "";
      $("#position-filter").value = "all";
      $("#era-filter").value = "all";
      renderRanking();
      announce("순위표 필터를 초기화했습니다.");
    });
    $("#ranking-body").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-player-id]");
      if (button) selectPlayer(button.dataset.playerId, true);
    });

    $("#scenario-tabs").addEventListener("click", (event) => {
      const tab = event.target.closest("[role=tab]");
      if (tab) activateScenario(tab.dataset.scenarioId);
    });
    $("#scenario-tabs").addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = $$("[role=tab]", event.currentTarget);
      const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
      let next = current;
      if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      activateScenario(tabs[next].dataset.scenarioId, true);
    });

    $("#weight-form").addEventListener("input", (event) => {
      const input = event.target.closest("input[type=range]");
      if (!input) return;
      state.customWeights[input.name] = finite(input.value);
      const total = Object.values(state.customWeights).reduce((sum, value) => sum + value, 0);
      if (total <= 0) {
        state.customWeights[input.name] = 1;
        input.value = "1";
      }
      renderCustomRanking();
    });
    $("#reset-weights").addEventListener("click", () => {
      state.customWeights = { ...state.defaultWeights };
      renderWeightSliders();
      announce("가중치를 균형 모델 기본값으로 복원했습니다.");
    });

    $("#compare-a").addEventListener("change", (event) => {
      state.compareA = event.target.value;
      if (state.compareA === state.compareB) {
        state.compareB = state.baseRanking.find((row) => row.player_id !== state.compareA)?.player_id || state.compareB;
      }
      renderCompare();
      announce("후보 비교를 업데이트했습니다.");
    });
    $("#compare-b").addEventListener("change", (event) => {
      state.compareB = event.target.value;
      if (state.compareA === state.compareB) {
        state.compareA = state.baseRanking.find((row) => row.player_id !== state.compareB)?.player_id || state.compareA;
      }
      renderCompare();
      announce("후보 비교를 업데이트했습니다.");
    });

    $("#raw-player").addEventListener("change", (event) => {
      state.rawPlayerId = event.target.value;
      renderRawData();
    });
    $("#raw-search").addEventListener("input", renderRawData);
    $("#download-csv").addEventListener("click", downloadRawCsv);

    let progressTicking = false;
    window.addEventListener("scroll", () => {
      if (progressTicking) return;
      progressTicking = true;
      requestAnimationFrame(() => {
        const height = document.documentElement.scrollHeight - window.innerHeight;
        const progress = height > 0 ? clamp((window.scrollY / height) * 100) : 0;
        $("#reading-progress-bar").style.width = `${progress}%`;
        progressTicking = false;
      });
    }, { passive: true });
  }

  function showReport() {
    document.body.classList.remove("is-loading");
    $("#loading-state").hidden = true;
    $("#error-state").hidden = true;
    $("#report").hidden = false;
    revealHeroScore();
  }

  function showError(error) {
    document.body.classList.remove("is-loading");
    $("#loading-state").hidden = true;
    $("#report").hidden = true;
    $("#error-state").hidden = false;
    $("#error-detail").textContent = error instanceof Error ? error.message : String(error);
    $("#error-state").focus?.();
  }

  async function load() {
    document.body.classList.add("is-loading");
    $("#loading-state").hidden = false;
    $("#error-state").hidden = true;
    try {
      const response = await fetch(DATA_URL, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`analysis.json 요청 실패: HTTP ${response.status}`);
      const raw = await response.json();
      prepareData(raw);
      renderAll();
      bindEvents();
      showReport();
    } catch (error) {
      console.error("GOAT report load failed", error);
      showError(error);
    }
  }

  $("#retry-button").addEventListener("click", () => window.location.reload());
  load();
})();
