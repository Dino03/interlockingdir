import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload, RefreshCw, FileDown, Search, Info, Bug } from "lucide-react";
import { Network } from "vis-network/standalone";

/**
 * Interlocking Directors – Single-file React App
 * - Paste a simple CSV edge list: Director,Company (one per line)
 * - Builds a bipartite graph (directors ↔ companies)
 * - Different shapes/styles for people vs. companies
 * - Auto report: key metrics, directors with multiple seats, company overlaps
 * - Export: PNG of the graph + CSV of the report
 * - Filter/search by name or minimum degree
 * - Network analytics: centrality, clique detection, and centralization metrics
*/

const SAMPLE = `# Director,Company (CSV; lines starting with # are comments)
# Tip: A director can appear on multiple lines with different companies
L. Garcia,Apex Mining
Jane Dela Cruz,Apex Mining
R. Mendoza,Aurora Biotech
Jane Dela Cruz,Aurora Biotech
H. Patel,Aurora Biotech
P. Lim,Eastgate Foods
L. Garcia,Eastgate Foods
L. Garcia,Terra Finance
K. Tan,Terra Finance
C. Bautista,Terra Finance
N. Singh,Empire Chemicals
M. Yamada,Empire Chemicals
M. Santos,Empire Chemicals
C. Bautista,Empire Chemicals
Alan Reyes,Empire Chemicals
L. Garcia,Granite Cement
Jane Dela Cruz,Granite Cement
A. Ocampo,Granite Cement
R. Mendoza,Helios Renewables
M. Yamada,Helios Renewables
Jane Dela Cruz,Helios Renewables
E. Chen,Helios Renewables
Alan Reyes,Helios Renewables
S. Choi,Metro Orion
H. Patel,Metro Orion
E. Chen,Metro Orion
C. Bautista,Metro Orion
P. Lim,Northbridge Capital
N. Singh,Northbridge Capital
Jane Dela Cruz,Northbridge Capital
D. Navarro,Northbridge Capital
Alan Reyes,Northbridge Capital
R. Mendoza,Atlantic Records
M. Santos,Atlantic Records
Jane Dela Cruz,Atlantic Records
T. Wu,Pacifica Telecom
S. Choi,Pacifica Telecom
K. Tan,Pacifica Telecom
T. Wu,Redwood Retail
P. Lim,Silver Peak Logistics
N. Singh,Silver Peak Logistics
M. Yamada,Silver Peak Logistics
M. Santos,Silver Peak Logistics
T. Wu,Skyline Property
S. Choi,Skyline Property
K. Tan,Skyline Property
T. Wu,Sunflare Corp
Alan Reyes,Sunflare Corp
P. Lim,Tristar Shipping
D. Navarro,Tristar Shipping
A. Ocampo,Tristar Shipping
M. Santos,Zircon Industries
K. Tan,Zircon Industries
H. Patel,Zircon Industries
E. Chen,Zircon Industries
H. Patel,Zircon International
D. Navarro,Zircon International
C. Bautista,Zircon International
`;

const DEGREE_COPY = {
  bipartite: {
    label: "Minimum degree",
    helper: (value) => value === 0
      ? "Showing all directors and companies regardless of degree."
      : `Showing nodes with degree ≥ ${value} (board connections).`
  },
  company: {
    label: "Min direct director links",
    helper: (value) => value === 0
      ? "Showing the focused company with all of its directors."
      : `Hiding directors with fewer than ${value} direct link${value === 1 ? "" : "s"} to the focused company.`
  },
  director: {
    label: "Min direct company links",
    helper: (value) => value === 0
      ? "Showing the focused director with all of their companies."
      : `Hiding companies with fewer than ${value} direct link${value === 1 ? "" : "s"} to the focused director.`
  }
};

const PERSON_PALETTE = {
  baseBackground: "#2563eb",
  baseBorder: "#1e40af",
  highlightBackground: "#1d4ed8",
  highlightBorder: "#1e3a8a",
  focusBackground: "#1e3a8a",
  focusBorder: "#0f172a",
  mutedBackground: "#bfdbfe",
  mutedBorder: "#93c5fd"
};

const COMPANY_PALETTE = {
  baseBackground: "#f59e0b",
  baseBorder: "#b45309",
  highlightBackground: "#f97316",
  highlightBorder: "#c2410c",
  focusBackground: "#ea580c",
  focusBorder: "#9a3412",
  mutedBackground: "#fde68a",
  mutedBorder: "#facc15"
};

// Lightweight CSV parser for lines like: name, company
function parseCSV(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const person = parts[0].trim();
    const company = parts.slice(1).join(",").trim();
    if (person && company) rows.push({ person, company });
  }
  return rows;
}

function unique(array) {
  return Array.from(new Set(array));
}

function toGraph(rows) {
  // Build node lists
  const people = unique(rows.map(r => r.person));
  const companies = unique(rows.map(r => r.company));

  // Maps for degree calculation
  const degreePerson = new Map(people.map(p => [p, 0]));
  const degreeCompany = new Map(companies.map(c => [c, 0]));

  const companySets = new Map(companies.map(c => [c, new Set()]));
  const personSets = new Map(people.map(p => [p, new Set()]));
  const directorAdjacency = new Map(people.map(p => [p, new Set()]));
  const companyAdjacency = new Map(companies.map(c => [c, new Set()]));

  const edges = [];
  for (const { person, company } of rows) {
    degreePerson.set(person, degreePerson.get(person) + 1);
    degreeCompany.set(company, degreeCompany.get(company) + 1);
    companySets.get(company).add(person);
    personSets.get(person).add(company);
    edges.push({ from: `P:${person}`, to: `C:${company}`, label: "" });
  }

  const nodes = [
    ...people.map(p => ({
      id: `P:${p}`,
      label: p,
      group: "person",
      shape: "dot",
      size: 16 + Math.min(20, (degreePerson.get(p) - 1) * 3),
      color: { background: "#2563eb", border: "#1e40af" },
      font: { color: "#0b1220" }
    })),
    ...companies.map(c => ({
      id: `C:${c}`,
      label: c,
      group: "company",
      shape: "box",
      margin: 8,
      widthConstraint: { maximum: 220 },
      color: { background: "#f59e0b", border: "#b45309" },
      font: { color: "#0b1220" }
    }))
  ];

  // Company↔Company overlaps via shared directors
  const companyOverlaps = [];
  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const a = companies[i], b = companies[j];
      const A = companySets.get(a), B = companySets.get(b);
      const inter = [...A].filter(x => B.has(x));
      if (inter.length > 0) {
        companyOverlaps.push({ a, b, via: inter });
        companyAdjacency.get(a).add(b);
        companyAdjacency.get(b).add(a);
      }
    }
  }

  const personOverlaps = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j];
      const A = personSets.get(a), B = personSets.get(b);
      const inter = [...A].filter(x => B.has(x));
      if (inter.length > 0) {
        personOverlaps.push({ a, b, via: inter });
        directorAdjacency.get(a).add(b);
        directorAdjacency.get(b).add(a);
      }
    }
  }

  const personAffiliations = new Map([...personSets.entries()].map(([k, v]) => [k, [...v]]));
  const companyAffiliations = new Map([...companySets.entries()].map(([k, v]) => [k, [...v]]));

  return {
    nodes,
    edges,
    degreePerson,
    degreeCompany,
    people,
    companies,
    companyOverlaps,
    personOverlaps,
    personAffiliations,
    companyAffiliations,
    directorAdjacency,
    companyAdjacency

  };
}

function computeCentralization(values) {
  if (!values || values.length === 0) return 0;
  const max = Math.max(...values);
  if (max <= 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const result = (max - mean) / max;
  return Number(result.toFixed(4));
}

function computeCentralityMetrics(adjacency) {
  const map = adjacency instanceof Map ? adjacency : new Map();
  const nodes = Array.from(map.keys());
  const n = nodes.length;

  const degree = new Map();
  const degreeRaw = new Map();
  const closeness = new Map();
  const betweenness = new Map();

  if (n === 0) {
    return {
      degree,
      degreeRaw,
      closeness,
      betweenness,
      centralization: { degree: 0, closeness: 0, betweenness: 0 }
    };
  }

  for (const node of nodes) {
    const neighbors = map.get(node) || new Set();
    const raw = neighbors.size;
    degreeRaw.set(node, raw);
    degree.set(node, n > 1 ? raw / (n - 1) : 0);
  }

  for (const source of nodes) {
    const distances = new Map(nodes.map(node => [node, Infinity]));
    distances.set(source, 0);
    const queue = [source];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      const currentDistance = distances.get(current);
      const neighbors = map.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (distances.get(neighbor) === Infinity) {
          distances.set(neighbor, currentDistance + 1);
          queue.push(neighbor);
        }
      }
    }

    const reachableDistances = [];
    distances.forEach((dist, node) => {
      if (node !== source && Number.isFinite(dist) && dist > 0) reachableDistances.push(dist);
    });

    if (reachableDistances.length === 0) {
      closeness.set(source, 0);
    } else {
      const totalDistance = reachableDistances.reduce((a, b) => a + b, 0);
      const reachableCount = reachableDistances.length;
      const reachRatio = n > 1 ? reachableCount / (n - 1) : 0;
      const proximity = totalDistance > 0 ? reachableCount / totalDistance : 0;
      closeness.set(source, reachRatio * proximity);
    }
  }

  const betweennessRaw = new Map(nodes.map(node => [node, 0]));
  for (const source of nodes) {
    const stack = [];
    const predecessors = new Map(nodes.map(node => [node, []]));
    const sigma = new Map(nodes.map(node => [node, 0]));
    const distance = new Map(nodes.map(node => [node, -1]));

    sigma.set(source, 1);
    distance.set(source, 0);

    const queue = [source];
    let qIndex = 0;
    while (qIndex < queue.length) {
      const v = queue[qIndex++];
      stack.push(v);
      const neighbors = map.get(v) || new Set();
      for (const neighbor of neighbors) {
        if (distance.get(neighbor) === -1) {
          distance.set(neighbor, distance.get(v) + 1);
          queue.push(neighbor);
        }
        if (distance.get(neighbor) === distance.get(v) + 1) {
          sigma.set(neighbor, sigma.get(neighbor) + sigma.get(v));
          predecessors.get(neighbor).push(v);
        }
      }
    }

    const delta = new Map(nodes.map(node => [node, 0]));
    while (stack.length) {
      const w = stack.pop();
      const coefficient = 1 + delta.get(w);
      for (const v of predecessors.get(w)) {
        const sigmaW = sigma.get(w);
        if (sigmaW === 0) continue;
        const contribution = (sigma.get(v) / sigmaW) * coefficient;
        delta.set(v, delta.get(v) + contribution);
      }
      if (w !== source) {
        betweennessRaw.set(w, betweennessRaw.get(w) + delta.get(w));
      }
    }
  }

  const denom = n > 2 ? ((n - 1) * (n - 2) / 2) : 0;
  for (const node of nodes) {
    const rawValue = betweennessRaw.get(node) / 2; // undirected graph
    betweenness.set(node, denom > 0 ? rawValue / denom : 0);
  }

  const centralization = {
    degree: computeCentralization([...degree.values()]),
    closeness: computeCentralization([...closeness.values()]),
    betweenness: computeCentralization([...betweenness.values()])

  };

  return { degree, degreeRaw, closeness, betweenness, centralization };
}

function rankCentrality(map, rawMap = null, limit = 3) {
  if (!(map instanceof Map)) return [];
  const entries = Array.from(map.entries()).map(([name, score]) => ({
    name,
    score,
    connections: rawMap instanceof Map ? (rawMap.get(name) ?? 0) : undefined
  }));
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });
  return entries.slice(0, limit);
}

function findCliques(adjacency, minSize = 3) {
  const map = adjacency instanceof Map ? adjacency : new Map();

  const run = (threshold) => {
    const nodes = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    const results = [];
    const seen = new Set();

    const bronKerbosch = (R, P, X) => {
      if (P.size === 0 && X.size === 0) {
        if (R.size >= threshold) {
          const clique = Array.from(R).sort((a, b) => a.localeCompare(b));
          const key = clique.join("||");
          if (!seen.has(key)) {
            seen.add(key);
            results.push(clique);
          }
        }
        return;
      }

      let pivot = null;
      const union = new Set([...P, ...X]);
      if (union.size > 0) {
        pivot = union.values().next().value;
      }
      const pivotNeighbors = pivot ? (map.get(pivot) || new Set()) : new Set();
      const candidates = [...P].filter(v => !pivotNeighbors.has(v));
      for (const v of candidates) {
        const neighbors = map.get(v) || new Set();
        const newR = new Set(R);
        newR.add(v);
        const newP = new Set([...P].filter(u => neighbors.has(u)));
        const newX = new Set([...X].filter(u => neighbors.has(u)));
        bronKerbosch(newR, newP, newX);
        P.delete(v);
        X.add(v);
      }
    };

    bronKerbosch(new Set(), new Set(nodes), new Set());

    results.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return a.join("|").localeCompare(b.join("|"));
    });

    return { cliques: results, threshold };
  };

  const initial = run(minSize);
  if (initial.cliques.length === 0 && minSize > 2) {
    return run(2);
  }
  return initial;
}

function computeCrossCliqueConnectors(cliques) {
  const counts = new Map();
  for (const clique of cliques) {
    const uniqueMembers = new Set(clique);
    for (const member of uniqueMembers) {
      counts.set(member, (counts.get(member) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .filter(item => item.count > 1)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 10);
}

function genReport(graph) {
  const {
    degreePerson,
    degreeCompany,
    people,
    companies,
    companyOverlaps,
    directorAdjacency,
    companyAdjacency
  } = graph;

  const multiSeatDirectors = people
    .map(p => ({ name: p, boards: degreePerson.get(p) }))
    .filter(x => x.boards > 1)
    .sort((a, b) => b.boards - a.boards);

  const highOverlapPairs = companyOverlaps
    .map(o => ({ pair: `${o.a} ↔ ${o.b}`, shared: o.via.length, via: o.via }))
    .sort((a, b) => b.shared - a.shared);

  const avgBoardsPerDirector = people.length
    ? (Array.from(degreePerson.values()).reduce((a, b) => a + b, 0) / people.length)
    : 0;

  const summary = {
    totalCompanies: companies.length,
    totalDirectors: people.length,
    totalBoardSeats: Array.from(degreeCompany.values()).reduce((a, b) => a + b, 0),
    avgBoardsPerDirector: Number(avgBoardsPerDirector.toFixed(2)),
    directorsWithMultipleSeats: multiSeatDirectors.length,
    companyPairsWithOverlap: highOverlapPairs.length,
  };

  const directorCentrality = computeCentralityMetrics(directorAdjacency);
  const companyCentrality = computeCentralityMetrics(companyAdjacency);

  const centrality = {
    directors: {
      degree: rankCentrality(directorCentrality.degree, directorCentrality.degreeRaw),
      closeness: rankCentrality(directorCentrality.closeness),
      betweenness: rankCentrality(directorCentrality.betweenness),
      centralization: directorCentrality.centralization
    },
    companies: {
      degree: rankCentrality(companyCentrality.degree, companyCentrality.degreeRaw),
      closeness: rankCentrality(companyCentrality.closeness),
      betweenness: rankCentrality(companyCentrality.betweenness),
      centralization: companyCentrality.centralization
    }
  };

  const cliqueResult = findCliques(directorAdjacency);
  const directorCliques = cliqueResult.cliques.map(members => ({
    members,
    size: members.length
  }));
  directorCliques.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return a.members.join("|").localeCompare(b.members.join("|"));
  });

  const crossCliqueConnectors = computeCrossCliqueConnectors(cliqueResult.cliques);

  const cliqueSizes = directorCliques.map(c => c.size);
  const largestCliqueSize = cliqueSizes.length ? Math.max(...cliqueSizes) : 0;

  summary.directorCliques = directorCliques.length;
  summary.largestDirectorClique = largestCliqueSize;
  summary.crossCliqueConnectors = crossCliqueConnectors.length;

  return {
    summary,
    multiSeatDirectors,
    highOverlapPairs,
    centrality,
    cliques: {
      directorCliques,
      crossCliqueConnectors,
      threshold: cliqueResult.threshold
    }
  };
}

function createBipartiteGraph(base) {
  const nodes = base.nodes.map(node => {
    const isPerson = node.id.startsWith("P:");
    const affiliation = isPerson
      ? base.personAffiliations.get(node.label) || []
      : base.companyAffiliations.get(node.label) || [];
    const affiliationText = affiliation.length ? `\n${affiliation.join(", ")}` : "";
    return {
      ...node,
      title: isPerson
        ? `Boards served: ${affiliation.length}${affiliationText}`
        : `Directors: ${affiliation.length}${affiliationText}`
    };
  });

  const nodeDegrees = new Map();
  for (const node of nodes) {
    const deg = node.id.startsWith("P:")
      ? base.degreePerson.get(node.label)
      : base.degreeCompany.get(node.label);
    nodeDegrees.set(node.id, deg || 0);
  }

  return { nodes, edges: base.edges, nodeDegrees };
}

function getNodeType(nodeId) {
  if (typeof nodeId !== "string") return "unknown";
  if (nodeId.startsWith("P:")) return "person";
  if (nodeId.startsWith("C:")) return "company";
  return "unknown";
}

function buildFocusGraph(base, bipartiteGraph, focusId) {
  if (!focusId) {
    return {
      nodes: [],
      edges: [],
      nodeDegrees: new Map(),
      physicsEnabled: false
    };
  }

  const nodeLookup = new Map(bipartiteGraph.nodes.map(node => [node.id, node]));
  const center = nodeLookup.get(focusId);
  if (!center) {
    return {
      nodes: [],
      edges: [],
      nodeDegrees: new Map(),
      physicsEnabled: false
    };
  }

  const isPerson = focusId.startsWith("P:");
  const label = center.label;
  const neighborLabels = isPerson
    ? base.personAffiliations.get(label) || []
    : base.companyAffiliations.get(label) || [];
  const neighborIds = Array.from(new Set(neighborLabels.map(name => isPerson ? `C:${name}` : `P:${name}`)))
    .filter(id => nodeLookup.has(id));


  const radius = Math.max(220, neighborIds.length * 60);
  const nodes = [];
  const nodeDegrees = new Map();


  const highlightColor = (() => {
    if (!center.color) return null;
    if (isPerson) {
      return {
        background: center.color.background,
        border: "#1d4ed8"
      };
    }
    return {
      background: center.color.background,
      border: "#c2410c"
    };
  })();

  nodes.push({
    ...center,
    x: 0,
    y: 0,
    physics: false,
    fixed: { x: true, y: true },
    borderWidth: 3,
    color: highlightColor ? { ...center.color, ...highlightColor } : center.color,
    font: center.font ? { ...center.font, size: 18 } : undefined

  });
  nodeDegrees.set(focusId, neighborIds.length);

  neighborIds.forEach((neighborId, index) => {
    const neighbor = nodeLookup.get(neighborId);
    if (!neighbor) return;
    const angle = neighborIds.length > 0
      ? (2 * Math.PI * index) / neighborIds.length
      : 0;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    nodes.push({
      ...neighbor,
      x,
      y,
      physics: false,
      fixed: { x: true, y: true }
    });
    nodeDegrees.set(neighborId, (nodeDegrees.get(neighborId) || 0) + 1);
  });

  const edges = neighborIds.map(neighborId => ({
    from: focusId,
    to: neighborId,
    smooth: false,
    width: 2.5,
    color: { color: "#475569", highlight: "#1f2937", opacity: 0.6 }
  }));

  return { nodes, edges, nodeDegrees, physicsEnabled: false };
}

function applyFocusHighlight(base, graph, focusNode) {
  const nodes = (graph.nodes || []).map(node => ({ ...node }));
  const edges = (graph.edges || []).map(edge => ({ ...edge }));

  if (!focusNode || !focusNode.id) {
    return { nodes, edges, highlightedIds: new Set() };
  }

  const type = getNodeType(focusNode.id);
  if (type === "unknown") {
    return { nodes, edges, highlightedIds: new Set() };
  }

  const label = focusNode.label;
  const neighborLabels = type === "person"
    ? base.personAffiliations.get(label) || []
    : base.companyAffiliations.get(label) || [];
  const neighborIds = new Set(neighborLabels.map(name => type === "person" ? `C:${name}` : `P:${name}`));
  neighborIds.add(focusNode.id);

  const decoratedNodes = nodes.map(node => {
    const isPerson = node.id.startsWith("P:");
    const palette = isPerson ? PERSON_PALETTE : COMPANY_PALETTE;

    if (!neighborIds.has(node.id)) {
      return {
        ...node,
        color: {
          background: palette.mutedBackground,
          border: palette.mutedBorder,
          highlight: { background: palette.highlightBackground, border: palette.highlightBorder },
          hover: { background: palette.highlightBackground, border: palette.highlightBorder }
        },
        borderWidth: 1
      };
    }

    if (node.id === focusNode.id) {
      const font = node.font ? { ...node.font, size: Math.max((node.font.size || 14), 18) } : { size: 18 };
      return {
        ...node,
        color: {
          background: palette.focusBackground,
          border: palette.focusBorder,
          highlight: { background: palette.focusBackground, border: palette.focusBorder },
          hover: { background: palette.focusBackground, border: palette.focusBorder }
        },
        borderWidth: Math.max(3, (node.borderWidth || 1) + 2),
        shadow: {
          enabled: true,
          color: "rgba(15,23,42,0.2)",
          size: 26,
          x: 0,
          y: 0
        },
        font
      };
    }

    return {
      ...node,
      color: {
        background: palette.highlightBackground,
        border: palette.highlightBorder,
        highlight: { background: palette.highlightBackground, border: palette.highlightBorder },
        hover: { background: palette.highlightBackground, border: palette.highlightBorder }
      },
      borderWidth: Math.max(2, (node.borderWidth || 1) + 1)
    };
  });

  const decoratedEdges = edges.map(edge => {
    const connectsHighlight = neighborIds.has(edge.from) && neighborIds.has(edge.to);
    if (!connectsHighlight) {
      return {
        ...edge,
        width: 1,
        color: {
          color: "rgba(148,163,184,0.25)",
          highlight: "rgba(100,116,139,0.35)",
          opacity: 0.18
        },
        smooth: false
      };
    }

    const connectsFocus = edge.from === focusNode.id || edge.to === focusNode.id;
    return {
      ...edge,
      width: connectsFocus ? 3.4 : 2.2,
      color: {
        color: connectsFocus ? "#1f2937" : "#334155",
        highlight: "#0f172a",
        opacity: connectsFocus ? 0.75 : 0.6
      },
      smooth: false
    };
  });

  return { nodes: decoratedNodes, edges: decoratedEdges, highlightedIds: neighborIds };
}

function buildCentricLayout(base, bipartiteGraph, centerType, focusNode) {
  const nodes = bipartiteGraph.nodes.map(node => ({ ...node }));
  const edges = bipartiteGraph.edges.map(edge => ({ ...edge }));
  const nodeLookup = new Map(nodes.map(node => [node.id, node]));

  const centers = centerType === "company" ? base.companies : base.people;
  const centerPrefix = centerType === "company" ? "C:" : "P:";
  const orbitPrefix = centerType === "company" ? "P:" : "C:";
  const affiliationMap = centerType === "company" ? base.companyAffiliations : base.personAffiliations;

  if (centers.length > 0) {
    const cols = Math.ceil(Math.sqrt(centers.length));
    const rows = Math.ceil(centers.length / cols);
    const cellWidth = 420;
    const cellHeight = 320;
    const xOffset = (cols - 1) / 2;
    const yOffset = (rows - 1) / 2;

    centers.forEach((label, index) => {
      const id = `${centerPrefix}${label}`;
      const node = nodeLookup.get(id);
      if (!node) return;
      const row = Math.floor(index / cols);
      const col = index % cols;
      const x = (col - xOffset) * cellWidth;
      const y = (row - yOffset) * cellHeight;
      node.x = x;
      node.y = y;
      node.physics = false;
      node.fixed = { x: true, y: true };
    });
  }

  const orbitPositions = new Map();
  centers.forEach((label) => {
    const centerId = `${centerPrefix}${label}`;
    const centerNode = nodeLookup.get(centerId);
    if (!centerNode) return;
    const affiliations = affiliationMap.get(label) || [];
    if (affiliations.length === 0) return;
    const sorted = [...affiliations].sort((a, b) => a.localeCompare(b));
    const count = sorted.length;
    const radius = 130 + Math.min(200, count * 28);

    sorted.forEach((neighborName, index) => {
      const neighborId = `${orbitPrefix}${neighborName}`;
      if (!nodeLookup.has(neighborId)) return;
      const angle = (2 * Math.PI * index) / count;
      const targetX = centerNode.x + Math.cos(angle) * radius;
      const targetY = centerNode.y + Math.sin(angle) * radius;
      const existing = orbitPositions.get(neighborId) || { x: 0, y: 0, count: 0 };
      existing.x += targetX;
      existing.y += targetY;
      existing.count += 1;
      orbitPositions.set(neighborId, existing);
    });
  });

  orbitPositions.forEach((value, id) => {
    const node = nodeLookup.get(id);
    if (!node) return;
    node.x = value.x / value.count;
    node.y = value.y / value.count;
    node.physics = false;
    node.fixed = { x: true, y: true };
  });

  nodes.forEach(node => {
    if (typeof node.x === "number" && typeof node.y === "number") {
      node.physics = false;
      node.fixed = { x: true, y: true };
    }
  });

  const highlighted = applyFocusHighlight(base, { nodes, edges }, focusNode);

  return {
    nodes: highlighted.nodes,
    edges: highlighted.edges,
    nodeDegrees: bipartiteGraph.nodeDegrees,
    physicsEnabled: false,
    base: bipartiteGraph
  };
}

function buildVisualization(base, mode, focusNode) {
  const bipartiteGraph = createBipartiteGraph(base);
  if (mode === "bipartite") {
    if (focusNode && focusNode.id) {
      const focused = buildFocusGraph(base, bipartiteGraph, focusNode.id);
      return { ...focused, base: bipartiteGraph };
    }
    return { ...bipartiteGraph, physicsEnabled: true, base: bipartiteGraph };
  }

  if (mode === "company") {
    return buildCentricLayout(base, bipartiteGraph, "company", focusNode);
  }

  if (mode === "director") {
    return buildCentricLayout(base, bipartiteGraph, "director", focusNode);
  }

  return { ...bipartiteGraph, physicsEnabled: true, base: bipartiteGraph };
}


function computeConvexHull(points) {
  if (!Array.isArray(points) || points.length <= 1) {
    return Array.isArray(points) ? [...points] : [];
  }
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function expandPolygon(points, padding = 24) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  const centroid = points.reduce((acc, point) => ({
    x: acc.x + point.x,
    y: acc.y + point.y
  }), { x: 0, y: 0 });
  centroid.x /= points.length;
  centroid.y /= points.length;
  return points.map(point => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const factor = (distance + padding) / distance;
    return {
      x: centroid.x + dx * factor,
      y: centroid.y + dy * factor
    };
  });
}

function buildCapsuleAroundPair(a, b, padding = 24) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = (dy / distance) * padding;
  const ny = (-dx / distance) * padding;
  return [
    { x: a.x - nx, y: a.y - ny },
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny }
  ];
}

function download(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") {
    throw new Error("Invalid data URL");
  }

  const [metadata, data] = dataUrl.split(",");
  if (typeof data === "undefined") {
    throw new Error("Malformed data URL");
  }

  const mimeMatch = metadata.match(/data:(.*?)(;base64)?$/);
  const mimeType = mimeMatch && mimeMatch[1] ? mimeMatch[1] : "application/octet-stream";
  const isBase64 = metadata.includes(";base64");

  if (!isBase64) {
    return new Blob([decodeURIComponent(data)], { type: mimeType });
  }

  const binary = atob(data);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });

}

function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function InterlockingDirectorsApp() {
  const [raw, setRaw] = useState(SAMPLE);
  const [minDegree, setMinDegree] = useState(0);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState("bipartite");
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugEvents, setDebugEvents] = useState([]);
  const [runtimeError, setRuntimeError] = useState(null);
  const debouncedQuery = useDebounced(query, 200);
  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const [pngUrl, setPngUrl] = useState(null);
  const pngUrlRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [focusNode, setFocusNode] = useState(null);
  const [selectionPosition, setSelectionPosition] = useState(null);
  const visibleNodesRef = useRef([]);
  const overlayPositionRef = useRef(null);

  const appendDebug = useCallback((type, payload) => {
    setDebugEvents(prev => {
      const now = new Date();
      const iso = now.toISOString();
      const timeLabel = iso.split("T")[1]?.replace("Z", "").slice(0, 8) || iso;
      const next = [{
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: iso,
        timeLabel,
        type,
        payload
      }, ...prev];
      return next.slice(0, 60);
    });
  }, []);

  const clearDebug = useCallback(() => setDebugEvents([]), []);

  const updatePngUrl = (url) => {
    if (pngUrlRef.current && pngUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(pngUrlRef.current);
    }
    pngUrlRef.current = url;
    setPngUrl(url);
  };

  useEffect(() => {
    return () => {
      if (pngUrlRef.current && pngUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(pngUrlRef.current);
      }
    };
  }, []);

  const openPngInNewTab = () => {
    if (pngUrl) window.open(pngUrl, '_blank', 'noopener');
  };

  const rows = useMemo(() => parseCSV(raw), [raw]);
  const baseGraph = useMemo(() => toGraph(rows), [rows]);
  const report = useMemo(() => genReport(baseGraph), [baseGraph]);
  const displayGraph = useMemo(
    () => buildVisualization(baseGraph, viewMode, focusNode),
    [baseGraph, viewMode, focusNode]
  );
  const maxDegree = useMemo(() => {
    const values = Array.from(displayGraph.nodeDegrees.values());
    return values.length ? Math.max(...values) : 0;
  }, [displayGraph]);

  useEffect(() => {
    if (!focusNode) return;
    const exists = baseGraph.nodes.some(node => node.id === focusNode.id);
    if (!exists) {
      setFocusNode(null);
    }
  }, [baseGraph, focusNode]);

  useEffect(() => {
    if (viewMode === "company") {
      if (focusNode && !focusNode.id.startsWith("C:")) {
        setFocusNode(null);
      }
    } else if (viewMode === "director") {
      if (focusNode && !focusNode.id.startsWith("P:")) {
        setFocusNode(null);
      }
    } else if (viewMode === "bipartite" && focusNode) {
      setFocusNode(null);
    }
  }, [viewMode, focusNode]);

  useEffect(() => {
    setMinDegree(prev => (prev > maxDegree ? maxDegree : prev));
  }, [maxDegree]);

  const sliderMax = Math.max(10, maxDegree);
  const degreeCopy = DEGREE_COPY[viewMode] || DEGREE_COPY.bipartite;

  const modeDescriptions = {
    bipartite: "Directors connect directly to the companies where they serve. Use the focus controls to center any node and view its immediate ties.",
    company: "Rebalances the entire network so every company sits at the heart of its director circle. Shared directors naturally land between overlapping firms.",
    director: "Repositions the full graph with directors anchoring their companies. Firms shared by multiple directors fall between the cliques they connect."
  };

  const viewOptions = [
    { key: "bipartite", label: "Combined" },
    { key: "company", label: "Company-centric" },
    { key: "director", label: "Director-centric" }
  ];

  // Build the vis-network graph with filters
  useEffect(() => {
    if (!containerRef.current) return;

    setRuntimeError(null);

    try {
      const q = debouncedQuery.trim().toLowerCase();
      const queryActive = q.length > 0;
      const availableNodes = displayGraph.nodes || [];
      const availableEdges = displayGraph.edges || [];
      const physicsEnabled = displayGraph.physicsEnabled !== false;

      let allowedIds = null;
      if (queryActive) {
        const matched = new Set();
        availableNodes.forEach(node => {
          const label = (node.label || "").toLowerCase();
          if (label.includes(q)) matched.add(node.id);
        });
        const neighbors = new Set();
        availableEdges.forEach(edge => {
          if (matched.has(edge.from)) neighbors.add(edge.to);
          if (matched.has(edge.to)) neighbors.add(edge.from);
        });
        allowedIds = new Set([...matched, ...neighbors]);
      }

      const nodes = availableNodes.filter(node => {
        const deg = displayGraph.nodeDegrees.get(node.id) || 0;
        const passDeg = deg >= (minDegree || 0);
        if (!queryActive) return passDeg;
        if (allowedIds && allowedIds.size > 0) {
          return passDeg && allowedIds.has(node.id);
        }
        return false;
      });

      const nodeSet = new Set(nodes.map(node => node.id));
      const edges = availableEdges.filter(edge => nodeSet.has(edge.from) && nodeSet.has(edge.to));

      visibleNodesRef.current = nodes;

      const options = {
        autoResize: true,
        physics: {
          enabled: physicsEnabled,
          solver: 'barnesHut',
          stabilization: physicsEnabled ? { iterations: 400, fit: true } : false,
          barnesHut: {
            gravitationalConstant: -8000,
            centralGravity: 0.15,
            springLength: 180,
            springConstant: 0.02,
            damping: 0.75,
            avoidOverlap: 0.3
          },
          timestep: 0.25,
          adaptiveTimestep: physicsEnabled,
          minVelocity: physicsEnabled ? 1.0 : 0.5
        },
        layout: { improvedLayout: physicsEnabled },
        nodes: {
          shadow: true,
          font: { face: "Inter, system-ui, sans-serif", size: 14 }
        },
        edges: {
          smooth: false,
          arrows: { to: { enabled: false } },
          color: { opacity: 0.4 }
        },
        interaction: { hover: true, tooltipDelay: 120, navigationButtons: true, keyboard: true }
      };

      const data = { nodes, edges };

      if (!networkRef.current) {
        networkRef.current = new Network(containerRef.current, data, options);
        appendDebug("network:init", { nodes: nodes.length, edges: edges.length, physicsEnabled });
      } else {
        networkRef.current.setOptions(options);
        networkRef.current.setData(data);
        appendDebug("network:update", { nodes: nodes.length, edges: edges.length, physicsEnabled });
      }

      const net = networkRef.current;
      if (net && !physicsEnabled) {
        const nodeIds = nodes.map(node => node.id);
        if (nodeIds.length > 0) {
          net.fit({ nodes: nodeIds, animation: { duration: 600, easingFunction: 'easeInOutQuad' } });
        }
      }

      const resize = () => net && net.redraw();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    } catch (error) {
      console.error(error);
      setRuntimeError(error);
      appendDebug("error", { stage: "network", message: error?.message || String(error) });
    }
  }, [displayGraph, minDegree, debouncedQuery, appendDebug]);

  useEffect(() => {
    appendDebug("data:rows", { count: rows.length });
  }, [rows, appendDebug]);

  useEffect(() => {
    appendDebug("data:graph", {
      nodes: baseGraph.nodes.length,
      edges: baseGraph.edges.length
    });
  }, [baseGraph, appendDebug]);

  useEffect(() => {
    appendDebug("state:viewMode", { viewMode });
  }, [viewMode, appendDebug]);

  useEffect(() => {
    appendDebug("state:focus", { focus: focusNode ? focusNode.id : null });
  }, [focusNode, appendDebug]);

  useEffect(() => {
    appendDebug("state:minDegree", { minDegree });
  }, [minDegree, appendDebug]);

  useEffect(() => {
    appendDebug("state:query", { query: debouncedQuery });
  }, [debouncedQuery, appendDebug]);

  useEffect(() => {
    if (!selectedNode) return;
    const stillVisible = (visibleNodesRef.current || []).some(node => node.id === selectedNode.id);
    if (!stillVisible) {
      setSelectedNode(null);
    }
  }, [displayGraph, selectedNode]);

  

  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;
    if (!focusNode || !focusNode.id) return;

    const visible = new Set((visibleNodesRef.current || []).map(node => node.id));
    if (!visible.has(focusNode.id)) return;

    const animation = { duration: 600, easingFunction: 'easeInOutQuad' };
    const scale = viewMode === "bipartite" ? 1 : 0.9;

    try {
      net.focus(focusNode.id, { scale, animation });
    } catch (err) {
      const position = net.getPositions([focusNode.id])[focusNode.id];
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
        net.moveTo({ position, scale, animation });
      }
    }
  }, [focusNode, viewMode, displayGraph, minDegree]);

  const exportPNG = async () => {
    const captureCanvasImage = async (canvas) => {
      const blob = await new Promise((resolve) => {
        if (typeof canvas.toBlob !== 'function') {
          resolve(null);
          return;
        }
        try {
          canvas.toBlob((result) => resolve(result || null), 'image/png');
        } catch (err) {
          console.warn('canvas.toBlob threw, will retry via data URL.', err);
          resolve(null);
        }
      });

      if (blob) {
        return { blob, dataUrl: null };
      }

      let dataUrl;
      try {
        dataUrl = canvas.toDataURL('image/png');
      } catch (err) {
        throw err;
      }

      let fromDataUrl = null;
      try {
        fromDataUrl = dataUrlToBlob(dataUrl);
      } catch (err) {
        console.warn('Conversion from data URL to Blob failed.', err);
      }

      return { blob: fromDataUrl, dataUrl };
    };

    const cloneCanvas = (canvas) => {
      const clone = document.createElement('canvas');
      const bounds = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, canvas.width || Math.round(bounds.width * dpr));
      const height = Math.max(1, canvas.height || Math.round(bounds.height * dpr));
      clone.width = width;
      clone.height = height;
      const ctx = clone.getContext('2d');
      if (!ctx) {
        throw new Error('Could not access 2D context for canvas clone.');
      }
      ctx.drawImage(canvas, 0, 0, width, height);
      return clone;
    };

    const deliverBlob = async (blob) => {
      if (!(blob instanceof Blob)) {
        throw new Error('Invalid PNG blob.');
      }

      const supportsPicker = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
      if (supportsPicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: 'interlocking-directors-graph.png',
            types: [
              {
                description: 'PNG Image',
                accept: { 'image/png': ['.png'] }
              }
            ]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          const previewUrl = URL.createObjectURL(blob);
          updatePngUrl(previewUrl);
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') {
            return;
          }
          console.warn('Save File Picker failed, falling back to download link.', err);
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const publish = (openTab) => {
        updatePngUrl(objectUrl);
        if (openTab) {
          window.open(objectUrl, '_blank', 'noopener');
        }
      };

      const isVivaldi = typeof navigator !== 'undefined' && /Vivaldi/i.test(navigator.userAgent || '');
      if (isVivaldi) {
        publish(true);
        return;
      }

      try {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = 'interlocking-directors-graph.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        publish(false);
      } catch (err) {
        console.warn('Automatic download failed, opening PNG in a new tab instead.', err);
        publish(true);
      }
    };
    
    const getCanvas = () => {
      const net = networkRef.current;
      if (net && net.canvas && net.canvas.frame && net.canvas.frame.canvas) {
        return net.canvas.frame.canvas;
      }
      const container = containerRef.current;
      if (!container) return null;
      return container.querySelector('canvas');
    };

    const src = getCanvas();
    if (!src) {
      alert('Graph canvas is not ready yet. Try again after the graph renders.');
      return;
    }


    const attemptCapture = async (canvas) => {
      try {
        return await captureCanvasImage(canvas);
      } catch (err) {
        console.warn('Primary canvas capture failed, retrying with clone.', err);
        const clone = cloneCanvas(canvas);
        try {
          const result = await captureCanvasImage(clone);
          return result;
        } finally {
          setTimeout(() => clone.remove(), 0);
        }
      }
    };

    let capture;
    try {
      capture = await attemptCapture(src);
    } catch (err) {
      console.error('Unable to export PNG from graph canvas.', err);
      alert('Could not generate the PNG export. Try again after the graph finishes rendering.');
      return;
    }

    if (!capture || (!capture.blob && !capture.dataUrl)) {
      alert('Graph rendering did not produce an image to export.');
      return;
    }

    if (capture.blob) {
      try {
        await deliverBlob(capture.blob);
        return;
      } catch (err) {
        console.error('Failed to hand off PNG blob for download.', err);
      }
    }

    if (capture.dataUrl) {
      updatePngUrl(capture.dataUrl);
      window.open(capture.dataUrl, '_blank', 'noopener');
    } else {
      alert('PNG export failed. Please try using a different browser.');
    }
    
  };

  const exportReportCSV = () => {
    const { summary, multiSeatDirectors, highOverlapPairs, centrality, cliques } = report;
    const formatScore = (value) => {
      if (typeof value !== "number" || Number.isNaN(value)) return "0.000";
      return value.toFixed(3);
    };
    const lines = [];
    lines.push("Section,Field,Value");
    lines.push(`Summary,Total Companies,${summary.totalCompanies}`);
    lines.push(`Summary,Total Directors,${summary.totalDirectors}`);
    lines.push(`Summary,Total Board Seats,${summary.totalBoardSeats}`);
    lines.push(`Summary,Avg Boards/Director,${summary.avgBoardsPerDirector}`);
    lines.push(`Summary,Directors with &gt;1 seat,${summary.directorsWithMultipleSeats}`);
    lines.push(`Summary,Company pairs with overlap,${summary.companyPairsWithOverlap}`);
    lines.push(`Summary,Director cliques identified,${summary.directorCliques || 0}`);
    lines.push(`Summary,Largest director clique,${summary.largestDirectorClique || 0}`);
    lines.push(`Summary,Cross-clique connectors,${summary.crossCliqueConnectors || 0}`);

    const directorCentralization = centrality?.directors?.centralization || {};
    const companyCentralization = centrality?.companies?.centralization || {};
    lines.push(`Summary,Director centralization (degree),${formatScore(directorCentralization.degree || 0)}`);
    lines.push(`Summary,Director centralization (closeness),${formatScore(directorCentralization.closeness || 0)}`);
    lines.push(`Summary,Director centralization (betweenness),${formatScore(directorCentralization.betweenness || 0)}`);
    lines.push(`Summary,Company centralization (degree),${formatScore(companyCentralization.degree || 0)}`);
    lines.push(`Summary,Company centralization (closeness),${formatScore(companyCentralization.closeness || 0)}`);
    lines.push(`Summary,Company centralization (betweenness),${formatScore(companyCentralization.betweenness || 0)}`);
    lines.push("");
    lines.push("Directors with Multiple Seats,Director,Boards");
    for (const d of multiSeatDirectors) lines.push(`Director,${d.name},${d.boards}`);
    lines.push("");
    lines.push("Company Overlaps,Company Pair,Shared Directors,Via");
    for (const p of highOverlapPairs) lines.push(`Overlap,${p.pair},${p.shared},"${p.via.join(" | ")}` + `"`);

    const directorCentralityLists = centrality?.directors || {};
    const companyCentralityLists = centrality?.companies || {};
    const addCentralityRows = (title, lists) => {
      lines.push("");
      lines.push(`${title},Measure,Name,Score,Details`);
      const measures = [
        ["Degree", lists.degree || []],
        ["Closeness", lists.closeness || []],
        ["Betweenness", lists.betweenness || []]
      ];
      for (const [label, items] of measures) {
        for (const item of items) {
          const detail = typeof item.connections === "number"
            ? `Connections: ${item.connections}`
            : "";
          lines.push(`${title},${label},${item.name},${formatScore(item.score)},${detail}`);
        }
      }
    };

    addCentralityRows("Director Centrality", directorCentralityLists);
    addCentralityRows("Company Centrality", companyCentralityLists);

    const cliqueGroups = cliques?.directorCliques || [];
    lines.push("");
    lines.push("Director Cliques,Size,Members");
    for (const clique of cliqueGroups) {
      lines.push(`Clique,${clique.size},"${clique.members.join(" | ")}` + `"`);
    }

    const connectorRows = cliques?.crossCliqueConnectors || [];
    lines.push("");
    lines.push("Cross-Clique Connectors,Name,Cliques Participated");
    for (const connector of connectorRows) {
      lines.push(`Connector,${connector.name},${connector.count}`);
    }

    download("interlocking-report.csv", lines.join("\n"));
  };

  const formatCentrality = (value) => (typeof value === "number" && !Number.isNaN(value) ? value.toFixed(3) : "0.000");
  const defaultCentralization = { degree: 0, closeness: 0, betweenness: 0 };
  const directorCentralityData = {
    degree: report.centrality?.directors?.degree || [],
    closeness: report.centrality?.directors?.closeness || [],
    betweenness: report.centrality?.directors?.betweenness || [],
    centralization: report.centrality?.directors?.centralization || defaultCentralization
  };
  const companyCentralityData = {
    degree: report.centrality?.companies?.degree || [],
    closeness: report.centrality?.companies?.closeness || [],
    betweenness: report.centrality?.companies?.betweenness || [],
    centralization: report.centrality?.companies?.centralization || defaultCentralization
  };
  const directorCliques = report.cliques?.directorCliques || [];
  const crossCliqueConnectors = report.cliques?.crossCliqueConnectors || [];
  const cliqueThreshold = report.cliques?.threshold || 3;
  const cliqueVisuals = useMemo(() => {
    const palette = [
      { fill: "rgba(59,130,246,0.12)", stroke: "rgba(37,99,235,0.55)" },
      { fill: "rgba(249,115,22,0.12)", stroke: "rgba(234,88,12,0.55)" },
      { fill: "rgba(16,185,129,0.12)", stroke: "rgba(5,150,105,0.55)" },
      { fill: "rgba(244,114,182,0.12)", stroke: "rgba(219,39,119,0.45)" },
      { fill: "rgba(165,180,252,0.12)", stroke: "rgba(99,102,241,0.5)" },
      { fill: "rgba(251,191,36,0.12)", stroke: "rgba(217,119,6,0.5)" }
    ];
    const groups = report.cliques?.directorCliques || [];
    return groups.map((clique, index) => {
      const paletteEntry = palette[index % palette.length];
      return {
        key: `clique-${index}`,
        nodeIds: clique.members.map(name => `P:${name}`),
        fill: paletteEntry.fill,
        stroke: paletteEntry.stroke
      };
    });
  }, [report.cliques]);

  const updateSelectionOverlayPosition = useCallback(() => {
    const net = networkRef.current;
    if (!net || !selectedNode) {
      if (overlayPositionRef.current !== null) {
        overlayPositionRef.current = null;
        setSelectionPosition(null);
      }
      return;
    }

    const positions = net.getPositions([selectedNode.id]);
    const pos = positions[selectedNode.id];
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      overlayPositionRef.current = null;
      setSelectionPosition(null);
      return;
    }

    const domPoint = net.canvasToDOM(pos);
    const next = { id: selectedNode.id, x: domPoint.x, y: domPoint.y };
    const prev = overlayPositionRef.current;
    if (!prev || prev.id !== next.id || Math.abs(prev.x - next.x) > 1 || Math.abs(prev.y - next.y) > 1) {
      overlayPositionRef.current = next;
      setSelectionPosition({ x: next.x, y: next.y });
    }
  }, [selectedNode]);

  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;

    const handle = () => updateSelectionOverlayPosition();
    net.on('dragging', handle);
    net.on('dragEnd', handle);
    net.on('zoom', handle);
    net.on('animationFinished', handle);
    net.on('afterDrawing', handle);

    return () => {
      net.off('dragging', handle);
      net.off('dragEnd', handle);
      net.off('zoom', handle);
      net.off('animationFinished', handle);
      net.off('afterDrawing', handle);
    };
  }, [updateSelectionOverlayPosition]);

  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;

    const findNode = (id) => {
      const visible = (visibleNodesRef.current || []).find(node => node.id === id);
      if (visible) return visible;
      const baseNode = (displayGraph.base?.nodes || []).find(node => node.id === id);
      if (baseNode) return baseNode;
      return baseGraph.nodes.find(node => node.id === id);
    };

    const handleSelectNode = (params) => {
      if (!params.nodes || params.nodes.length === 0) return;
      const id = params.nodes[0];
      const node = findNode(id);
      const label = node?.label || id.replace(/^P:/, "").replace(/^C:/, "");
      const selection = { id, label, type: getNodeType(id) };
      setSelectedNode(selection);
      setTimeout(() => updateSelectionOverlayPosition(), 0);
    };

    const handleDeselectNode = () => {
      setSelectedNode(null);
      overlayPositionRef.current = null;
      setSelectionPosition(null);
    };

    const handleClick = (params) => {
      if (!params.nodes || params.nodes.length === 0) {
        setSelectedNode(null);
        overlayPositionRef.current = null;
        setSelectionPosition(null);
      }
    };

    const handleDoubleClick = (params) => {
      if (!params.nodes || params.nodes.length === 0) return;
      const id = params.nodes[0];
      const node = findNode(id);
      const label = node?.label || id.replace(/^P:/, "").replace(/^C:/, "");
      const type = getNodeType(id);
      const selection = { id, label, type };
      setSelectedNode(selection);
      if (type === "company" && viewMode !== "company") {
        setViewMode("company");
      } else if (type === "person" && viewMode !== "director") {
        setViewMode("director");
      }
      setFocusNode(selection);
      setTimeout(() => updateSelectionOverlayPosition(), 0);
    };

    net.on('selectNode', handleSelectNode);
    net.on('deselectNode', handleDeselectNode);
    net.on('click', handleClick);
    net.on('doubleClick', handleDoubleClick);

    return () => {
      net.off('selectNode', handleSelectNode);
      net.off('deselectNode', handleDeselectNode);
      net.off('click', handleClick);
      net.off('doubleClick', handleDoubleClick);
    };
  }, [displayGraph, baseGraph, viewMode, updateSelectionOverlayPosition]);

  useEffect(() => {
    updateSelectionOverlayPosition();
  }, [updateSelectionOverlayPosition, displayGraph]);


  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;

    const drawCliques = (ctx) => {
      if (!ctx) return;
      const visibleIds = new Set((visibleNodesRef.current || []).map(node => node.id));
      const ratio = net?.canvas?.pixelRatio || window.devicePixelRatio || 1;
      cliqueVisuals.forEach(clique => {
        const ids = clique.nodeIds.filter(id => visibleIds.has(id));
        if (ids.length < 2) return;
        const positions = net.getPositions(ids);
        const points = ids
          .map(id => positions[id])
          .filter(pos => pos && Number.isFinite(pos.x) && Number.isFinite(pos.y))
          .map(pos => net.canvasToDOM(pos));
        if (points.length < 2) return;

        let polygon;
        if (points.length === 2) {
          polygon = buildCapsuleAroundPair(points[0], points[1], 28);
        } else {
          const hull = computeConvexHull(points);
          if (hull.length === 0) return;
          polygon = expandPolygon(hull, 36);
        }

        if (!polygon || polygon.length < 3) return;

        const scaledPolygon = polygon.map(point => ({
          x: point.x * ratio,
          y: point.y * ratio
        }));

        ctx.save();
        ctx.beginPath();
        scaledPolygon.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
        ctx.fillStyle = clique.fill;
        ctx.strokeStyle = clique.stroke;
        ctx.lineWidth = 2 * ratio;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    };

    net.on('afterDrawing', drawCliques);
    net.redraw();
    return () => {
      net.off('afterDrawing', drawCliques);
    };
  }, [cliqueVisuals]);

  const renderCentralityItems = (items, keyPrefix, includeConnections = false) => {
    if (!items || items.length === 0) {
      return [<li key={`${keyPrefix}-empty`} className="text-slate-500">No data</li>];
    }
    return items.map(item => (
      <li key={`${keyPrefix}-${item.name}`} className="flex justify-between gap-2">
        <span>{item.name}</span>
        <span className="text-slate-500">
          {formatCentrality(item.score)}
          {includeConnections && typeof item.connections === "number" ? ` (${item.connections})` : ""}
        </span>
      </li>
    ));
  };

  const focusButtonLabel = selectedNode?.type === "company"
    ? "Center company cluster"
    : selectedNode?.type === "person"
      ? "Center director web"
      : "Focus connections";

  const handleFocusSelection = () => {
    if (!selectedNode) return;
    if (viewMode === "company" && selectedNode.type !== "company") {
      setViewMode("director");
    } else if (viewMode === "director" && selectedNode.type !== "person") {
      setViewMode("company");
    }
    setFocusNode(selectedNode);
  };


  const clearFocus = () => {
    if (viewMode === "bipartite") {
      setFocusNode(null);
    }
  };

  const resetSample = () => setRaw(SAMPLE);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2 font-semibold text-xl">
            <span className="inline-flex items-center justify-center rounded-2xl bg-blue-600 text-white h-9 w-9">ID</span>
            <span>Interlocking Directors Analyzer</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDebugEnabled(prev => !prev)}
              className={[
                "inline-flex items-center gap-2 rounded-2xl px-3 py-2 border transition",
                debugEnabled
                  ? "bg-slate-900 text-white border-slate-900 hover:opacity-90"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              ].join(" ")}
            >
              <Bug className="h-4 w-4" />
              {debugEnabled ? "Hide debug" : "Show debug"}
              {runtimeError ? (
                <span className="ml-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">error</span>
              ) : null}
            </button>
            <button onClick={exportPNG} className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 bg-slate-900 text-white hover:opacity-90 shadow">
              <Download className="h-4 w-4"/> Export PNG
            </button>
            <button onClick={exportReportCSV} className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50">
              <FileDown className="h-4 w-4"/> Report CSV
            </button>
          </div>
        </div>
      </header>

      {runtimeError && (
        <div className="mx-auto max-w-7xl px-4 pt-4">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 shadow">
            <div className="font-semibold">Network rendering failed</div>
            <p className="mt-1 break-words font-mono text-xs">
              {runtimeError.message || 'An unknown error occurred while drawing the graph.'}
            </p>
            <p className="mt-2 text-xs text-rose-600">
              The error details are captured in the debug inspector. Review the latest events below to diagnose blank screen issues.
            </p>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Controls */}
        <section className="lg:col-span-1 space-y-4">
          {debugEnabled && (
            <div className="bg-slate-900 text-slate-100 rounded-2xl shadow p-4 space-y-3 max-h-80 overflow-auto">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Debug inspector</div>
                  <p className="text-xs text-slate-300">Latest app events appear here for troubleshooting blank screens.</p>
                </div>
                <button
                  type="button"
                  onClick={clearDebug}
                  className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-2 text-xs font-mono">
                {debugEvents.length === 0 ? (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-slate-300">
                    No debug events captured yet. Interact with the app or import data to populate this feed.
                  </div>
                ) : (
                  debugEvents.map(event => (
                    <div key={event.id} className="rounded-xl border border-slate-700/60 bg-slate-800/60 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="uppercase tracking-wide text-[10px] text-slate-400">{event.type}</span>
                        <span className="text-[11px] text-slate-500">{event.timeLabel}</span>
                      </div>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-slate-200">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="flex items-center gap-2 text-slate-700">
              <Info className="h-4 w-4"/>
              <p className="text-sm">Paste CSV as <span className="font-mono">Director,Company</span>. Lines starting with <span className="font-mono">#</span> are ignored.</p>
            </div>
            <textarea
              className="w-full h-56 font-mono text-sm p-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={raw}
              onChange={e => setRaw(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button onClick={resetSample} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 bg-white border hover:bg-slate-50">
                <RefreshCw className="h-4 w-4"/> Reset sample
              </button>
              <label className="inline-flex items-center gap-2 rounded-xl px-3 py-2 bg-white border hover:bg-slate-50 cursor-pointer">
                <Upload className="h-4 w-4"/> Import .csv
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => setRaw(String(reader.result || ""));
                    reader.readAsText(file);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4"/>
              <input
                type="text"
                placeholder="Search name…"
                className="flex-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <label className="block text-sm text-slate-700">{degreeCopy.label}</label>
            <input
              type="range"
              min={0}
              max={sliderMax}
              value={minDegree}
              onChange={(e) => setMinDegree(parseInt(e.target.value || "0", 10))}
              className="w-full"
            />
            <div className="text-sm text-slate-600">{degreeCopy.helper(minDegree)}</div>
            <div className="border-t border-slate-100 pt-3">
              <div className="text-sm font-semibold mb-2">Visualization focus</div>
              <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
                {viewOptions.map(option => {
                  const isActive = viewMode === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        setViewMode(option.key);
                        if (option.key === "bipartite") {
                          setFocusNode(null);
                        } else if (option.key === "company") {
                          setFocusNode(prev => (prev && prev.id.startsWith("C:") ? prev : null));
                        } else if (option.key === "director") {
                          setFocusNode(prev => (prev && prev.id.startsWith("P:") ? prev : null));
                        }
                      }}
                      className={[
                        "rounded-xl px-3 py-2 border transition",
                        isActive
                          ? "bg-slate-900 border-slate-900 text-white shadow"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      ].join(" ")}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500 mt-2 leading-snug">{modeDescriptions[viewMode]}</p>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <div className="text-sm font-semibold mb-2">Legend</div>
              {viewMode === "bipartite" ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#2563eb" }}></span>
                      Director (dot)
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3" style={{ background: "#f59e0b" }}></span>
                      Company (box)
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">Dots scale with number of boards served; edges show direct board appointments. Shaded halos outline detected director cliques.</p>
                </>
              ) : viewMode === "company" ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3" style={{ background: "#f59e0b" }}></span>
                      Company (center)
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#2563eb" }}></span>
                      Directors (ring)
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">All companies are pinned at the center of their director circles. Shared directors fall between the clusters they connect.</p>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#2563eb" }}></span>
                      Director (center)
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3" style={{ background: "#f59e0b" }}></span>
                      Companies (ring)
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">Each director is centered with their companies orbiting them. Companies shared by multiple leaders float between overlapping webs.</p>
                </>
              )}
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-2">
              <div className="text-sm font-semibold">Focus layout</div>
              <p className="text-xs text-slate-500 leading-snug">Select a node on the canvas and click focus to center it and display its direct connections like a web. You can also double-click any node to jump straight into its cluster.</p>
              {focusNode ? (
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Focused on: <span className="font-medium text-slate-700">{focusNode.label}</span></span>
                  {viewMode === "bipartite" && (
                    <button
                      type="button"
                      onClick={clearFocus}
                      className="text-blue-600 hover:underline"
                    >
                      Show full network
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-500">Full network shown.</div>
              )}
              {selectedNode ? (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-600">
                    Selected: <span className="font-medium text-slate-700">{selectedNode.label}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleFocusSelection}
                    className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow hover:opacity-90"
                  >
                    Focus on {selectedNode.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedNode(null)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Clear selection
                  </button>
                  <p className="text-[11px] text-slate-500">The view switches to match the node type when focusing.</p>
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">Click a node in the canvas to enable the focus button.</p>
              )}
            </div>
          </div>

          {/* Report */}
          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            <h3 className="font-semibold">Report</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Companies</dt><dd>{report.summary.totalCompanies}</dd>
              <dt className="text-slate-500">Directors</dt><dd>{report.summary.totalDirectors}</dd>
              <dt className="text-slate-500">Board seats</dt><dd>{report.summary.totalBoardSeats}</dd>
              <dt className="text-slate-500">Avg boards / director</dt><dd>{report.summary.avgBoardsPerDirector}</dd>
              <dt className="text-slate-500">Directors with &gt; 1 seat</dt><dd>{report.summary.directorsWithMultipleSeats}</dd>
              <dt className="text-slate-500">Company pairs w/ overlap</dt><dd>{report.summary.companyPairsWithOverlap}</dd>
              <dt className="text-slate-500">Director cliques</dt><dd>{report.summary.directorCliques}</dd>
              <dt className="text-slate-500">Largest clique size</dt><dd>{report.summary.largestDirectorClique}</dd>
              <dt className="text-slate-500">Cross-clique connectors</dt><dd>{report.summary.crossCliqueConnectors}</dd>
            </dl>

            {report.multiSeatDirectors.length > 0 && (
              <div className="mt-3">
                <div className="text-sm font-semibold mb-1">Directors with multiple seats</div>
                <ul className="text-sm space-y-1 max-h-40 overflow-auto pr-1">
                  {report.multiSeatDirectors.map(d => (
                    <li key={d.name} className="flex justify-between gap-2"><span>{d.name}</span><span className="text-slate-500">{d.boards}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {report.highOverlapPairs.length > 0 && (
              <div className="mt-3">
                <div className="text-sm font-semibold mb-1">Company overlaps (shared directors)</div>
                <ul className="text-sm space-y-1 max-h-40 overflow-auto pr-1">
                  {report.highOverlapPairs.map(p => (
                    <li key={p.pair} className="flex flex-col">
                      <div className="flex justify-between gap-2">
                        <span>{p.pair}</span>
                        <span className="text-slate-500">{p.shared}</span>
                      </div>
                      <div className="text-xs text-slate-500 truncate">Via: {p.via.join(" • ")}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 space-y-3">
              <div>
                <div className="text-sm font-semibold mb-1">Director centrality (top 3)</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="font-medium text-slate-600">Degree</div>
                    <ul className="mt-1 space-y-1">
                      {renderCentralityItems(directorCentralityData.degree, "director-degree", true)}
                    </ul>
                  </div>
                  <div>
                    <div className="font-medium text-slate-600">Closeness</div>
                    <ul className="mt-1 space-y-1">
                      {renderCentralityItems(directorCentralityData.closeness, "director-closeness")}
                    </ul>
                  </div>
                  <div>
                    <div className="font-medium text-slate-600">Betweenness</div>
                    <ul className="mt-1 space-y-1">
                      {renderCentralityItems(directorCentralityData.betweenness, "director-betweenness")}
                    </ul>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2">Scores are normalized between 0 and 1. Degree values show the normalized score with raw connections in parentheses.</p>
              </div>

              <div>
                <div className="text-sm font-semibold mb-1">Director network centralization</div>
                <ul className="text-xs space-y-1">
                  <li className="flex justify-between gap-2"><span>Degree</span><span className="font-mono">{formatCentrality(directorCentralityData.centralization.degree)}</span></li>
                  <li className="flex justify-between gap-2"><span>Closeness</span><span className="font-mono">{formatCentrality(directorCentralityData.centralization.closeness)}</span></li>
                  <li className="flex justify-between gap-2"><span>Betweenness</span><span className="font-mono">{formatCentrality(directorCentralityData.centralization.betweenness)}</span></li>
                </ul>
              </div>

              <div>
                <div className="text-sm font-semibold mb-1">Company centrality (top 3)</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="font-medium text-slate-600">Degree</div>
                    <ul className="mt-1 space-y-1">
                      {renderCentralityItems(companyCentralityData.degree, "company-degree", true)}
                    </ul>
                  </div>
                  <div>
                    <div className="font-medium text-slate-600">Closeness</div>
                    <ul className="mt-1 space-y-1">
                      {renderCentralityItems(companyCentralityData.closeness, "company-closeness")}
                    </ul>
                  </div>
                  <div>
                    <div className="font-medium text-slate-600">Betweenness</div>
                    <ul className="mt-1 space-y-1">
                      {renderCentralityItems(companyCentralityData.betweenness, "company-betweenness")}
                    </ul>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold mb-1">Company network centralization</div>
                <ul className="text-xs space-y-1">
                  <li className="flex justify-between gap-2"><span>Degree</span><span className="font-mono">{formatCentrality(companyCentralityData.centralization.degree)}</span></li>
                  <li className="flex justify-between gap-2"><span>Closeness</span><span className="font-mono">{formatCentrality(companyCentralityData.centralization.closeness)}</span></li>
                  <li className="flex justify-between gap-2"><span>Betweenness</span><span className="font-mono">{formatCentrality(companyCentralityData.centralization.betweenness)}</span></li>
                </ul>
              </div>

              <div>
                <div className="text-sm font-semibold mb-1">Director cliques</div>
                {directorCliques.length > 0 ? (
                  <>
                    <p className="text-xs text-slate-500">
                      {cliqueThreshold >= 3
                        ? `Cliques require at least ${cliqueThreshold} directors all connected through shared boards.`
                        : "No 3+ director cliques detected; displaying tightly linked director pairs."}
                    </p>
                    <ul className="text-xs space-y-1 max-h-40 overflow-auto pr-1 mt-2">
                      {directorCliques.map((clique, index) => (
                        <li key={`clique-${clique.members.join('|')}`} className="flex flex-col gap-1">
                          <div className="flex justify-between gap-2">
                            <span>Group {index + 1}</span>
                            <span className="text-slate-500">{clique.size} {clique.size === 1 ? "member" : "members"}</span>
                          </div>
                          <div className="text-slate-500">{clique.members.join(" • ")}</div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">No director cliques detected.</p>
                )}
              </div>

              <div>
                <div className="text-sm font-semibold mb-1">Cross-clique connectors</div>
                {crossCliqueConnectors.length > 0 ? (
                  <ul className="text-xs space-y-1">
                    {crossCliqueConnectors.map(item => (
                      <li key={`connector-${item.name}`} className="flex justify-between gap-2">
                        <span>{item.name}</span>
                        <span className="text-slate-500">{item.count} {item.count === 1 ? "clique" : "cliques"}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">No directors participate in multiple cliques.</p>
                )}
              </div>
            </div>
          </div>

          {/* PNG Preview & Manual Save */}
          {pngUrl && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-3">
              <div className="text-sm font-semibold">PNG ready</div>
              <p className="text-xs text-slate-500">If your browser blocked the auto-download, use the buttons below or right-click the image to save.</p>
              <div className="flex gap-2">
                <a href={pngUrl} download="interlocking-directors-graph.png" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 bg-slate-900 text-white hover:opacity-90 shadow">Download PNG</a>
                <button onClick={openPngInNewTab} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 bg-white border hover:bg-slate-50">Open in new tab</button>
              </div>
              <img src={pngUrl} alt="Graph PNG preview" className="w-full rounded-xl border"/>
            </div>
          )}

        </section>

        {/* Right: Graph */}
        <section className="lg:col-span-2">
          <div className="bg-white rounded-2xl shadow p-2 h-[72vh]">
            <div className="relative h-full w-full rounded-2xl">
              <div ref={containerRef} className="h-full w-full rounded-2xl" />
              {selectedNode && selectionPosition && (
                <div
                  className="pointer-events-none absolute z-20"
                  style={{ left: selectionPosition.x, top: selectionPosition.y }}
                >
                  <div className="pointer-events-auto -translate-x-1/2 -translate-y-4 whitespace-nowrap rounded-xl bg-white/95 px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200">
                    <div className="font-semibold text-slate-700">{selectedNode.label}</div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleFocusSelection();
                      }}
                      className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow hover:opacity-90"
                    >
                      {focusButtonLabel}
                    </button>
                    <div className="mt-1 text-[11px] text-slate-500">Double-click the node to center instantly.</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-6 text-xs text-slate-500">
        Built with <span className="font-mono">vis-network</span>. Paste your data and export the visualization &amp; report. No upload leaves your browser.
      </footer>
    </div>
  );
}
