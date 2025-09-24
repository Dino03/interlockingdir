import React, { useEffect, useMemo, useRef, useState } from "react";
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
 * - Includes a small self-check test harness (Debug panel)
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

  const edges = [];
  for (const { person, company } of rows) {
    degreePerson.set(person, degreePerson.get(person) + 1);
    degreeCompany.set(company, degreeCompany.get(company) + 1);
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
  const companySets = new Map(companies.map(c => [c, new Set()]));
  for (const { person, company } of rows) {
    companySets.get(company).add(person);
  }
  const companyOverlaps = [];
  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const a = companies[i], b = companies[j];
      const A = companySets.get(a), B = companySets.get(b);
      const inter = [...A].filter(x => B.has(x));
      if (inter.length > 0) companyOverlaps.push({ a, b, via: inter });
    }
  }

  return { nodes, edges, degreePerson, degreeCompany, people, companies, companyOverlaps };
}

function genReport(graph) {
  const { degreePerson, degreeCompany, people, companies, companyOverlaps } = graph;

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

  return { summary, multiSeatDirectors, highOverlapPairs };
}

function download(filename, text) {
  const a = document.createElement("a");
  a.setAttribute("href", URL.createObjectURL(new Blob([text], { type: "text/plain" })));
  a.setAttribute("download", filename);
  a.click();
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
  const [showDebug, setShowDebug] = useState(false);
  const [testLog, setTestLog] = useState("");
  const debouncedQuery = useDebounced(query, 200);
  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const [pngUrl, setPngUrl] = useState(null);
  const openPngInNewTab = () => {
    if (pngUrl) window.open(pngUrl, '_blank', 'noopener');
  };

  const rows = useMemo(() => parseCSV(raw), [raw]);
  const graph = useMemo(() => toGraph(rows), [rows]);
  const report = useMemo(() => genReport(graph), [graph]);

  // Build the vis-network graph with filters
  useEffect(() => {
    if (!containerRef.current) return;

    const q = debouncedQuery.trim().toLowerCase();

    const nodes = graph.nodes.filter(n => {
      const deg = n.id.startsWith("P:")
        ? graph.degreePerson.get(n.label)
        : graph.degreeCompany.get(n.label);
      const passDeg = deg >= (minDegree || 0);
      const passQ = q ? n.label.toLowerCase().includes(q) : true;
      return passDeg && passQ;
    });

    const nodeSet = new Set(nodes.map(n => n.id));
    const edges = graph.edges.filter(e => nodeSet.has(e.from) && nodeSet.has(e.to));

    const options = {
      autoResize: true,
      physics: {
        solver: 'barnesHut',
        // Make the layout calmer and reduce "bounce"
        stabilization: { iterations: 400, fit: true },
        barnesHut: {
          gravitationalConstant: -8000,   // weaker repulsion than before (-25000)
          centralGravity: 0.15,           // pull a bit toward center
          springLength: 180,              // longer springs = less jitter
          springConstant: 0.02,           // softer springs
          damping: 0.75,                  // higher damping = less bouncy
          avoidOverlap: 0.3
        },
        timestep: 0.25,
        adaptiveTimestep: true,
        minVelocity: 1.0
      },
      layout: { improvedLayout: true },
      nodes: {
        shadow: true,
        font: { face: "Inter, system-ui, sans-serif", size: 14 }
      },
      edges: {
        // Make lines straighter / less flexible
        smooth: false,
        arrows: { to: { enabled: false } },
        color: { opacity: 0.4 }
      },
      interaction: { hover: true, tooltipDelay: 120, navigationButtons: true, keyboard: true }
    };

    const data = { nodes, edges };

    if (!networkRef.current) {
      networkRef.current = new Network(containerRef.current, data, options);
    } else {
      networkRef.current.setData(data);
      networkRef.current.setOptions(options);
    }

    const net = networkRef.current;
    const resize = () => net && net.redraw();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [graph, minDegree, debouncedQuery]);

  const exportPNG = () => {
    // Get the actual canvas from vis-network
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

    // Primary path: direct dataURL from the source canvas
    let dataUrl = '';
    try {
      dataUrl = src.toDataURL('image/png');
    } catch (e) {
      console.warn('toDataURL failed, falling back to copy-to-temp-canvas', e);
      // Fallback: copy to a temp canvas first
      const tmp = document.createElement('canvas');
      // Use devicePixelRatio for crispness
      const dpr = window.devicePixelRatio || 1;
      const b = src.getBoundingClientRect();
      const w = Math.max(src.width, Math.round(b.width * dpr));
      const h = Math.max(src.height, Math.round(b.height * dpr));
      tmp.width = w;
      tmp.height = h;
      const ctx = tmp.getContext('2d');
      ctx.drawImage(src, 0, 0, w, h);
      dataUrl = tmp.toDataURL('image/png');
      setTimeout(() => tmp.remove(), 0);
    }

    if (!dataUrl) {
      alert('Could not generate PNG.');
      return;
    }

    // Try programmatic download first
    try {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'interlocking-directors-graph.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.warn('Automatic download blocked by browser.', e);
    }

    // Always set preview URL so the user has a manual fallback
    setPngUrl(dataUrl);
  };

  const exportReportCSV = () => {
    const { summary, multiSeatDirectors, highOverlapPairs } = report;
    const lines = [];
    lines.push("Section,Field,Value");
    lines.push(`Summary,Total Companies,${summary.totalCompanies}`);
    lines.push(`Summary,Total Directors,${summary.totalDirectors}`);
    lines.push(`Summary,Total Board Seats,${summary.totalBoardSeats}`);
    lines.push(`Summary,Avg Boards/Director,${summary.avgBoardsPerDirector}`);
    lines.push(`Summary,Directors with &gt;1 seat,${summary.directorsWithMultipleSeats}`);
    lines.push(`Summary,Company pairs with overlap,${summary.companyPairsWithOverlap}`);
    lines.push("");
    lines.push("Directors with Multiple Seats,Director,Boards");
    for (const d of multiSeatDirectors) lines.push(`Director,${d.name},${d.boards}`);
    lines.push("");
    lines.push("Company Overlaps,Company Pair,Shared Directors,Via");
    for (const p of highOverlapPairs) lines.push(`Overlap,${p.pair},${p.shared},"${p.via.join(" | ")}` + `"`);

    download("interlocking-report.csv", lines.join("\n"));
  };

  const resetSample = () => setRaw(SAMPLE);

  // --- Simple self-check tests ---
  const runSelfChecks = () => {
    const results = [];

    // Test 1: parseCSV basic & comments
    const t1Input = `# comment\nA, X\nA, Y\nB, Y\n`;
    const t1Rows = parseCSV(t1Input);
    results.push({ test: "parseCSV basic", expectRows: 3, gotRows: t1Rows.length, pass: t1Rows.length === 3 });

    // Test 2: duplicate edges counted
    const t2Input = `A, X\nA, X\n`;
    const t2 = toGraph(parseCSV(t2Input));
    results.push({ test: "duplicate edges count", expectEdges: 2, gotEdges: t2.edges.length, pass: t2.edges.length === 2 });
    results.push({ test: "degree counts duplicates (person)", expect: 2, got: t2.degreePerson.get("A"), pass: t2.degreePerson.get("A") === 2 });

    // Test 3: report metrics
    const t3 = toGraph(parseCSV(`A,X\nA,Y\nB,Y\n`));
    const r3 = genReport(t3);
    results.push({ test: "summary counts", expect: { companies: 2, directors: 2, seats: 3 }, got: { companies: r3.summary.totalCompanies, directors: r3.summary.totalDirectors, seats: r3.summary.totalBoardSeats }, pass: r3.summary.totalCompanies === 2 && r3.summary.totalDirectors === 2 && r3.summary.totalBoardSeats === 3 });
    results.push({ test: "avg boards per director", expect: 1.5, got: r3.summary.avgBoardsPerDirector, pass: r3.summary.avgBoardsPerDirector === 1.5 });
    results.push({ test: "multi-seat directors", expect: 1, got: r3.multiSeatDirectors.length, pass: r3.multiSeatDirectors.length === 1 });
    results.push({ test: "company pairs with overlap", expect: 1, got: r3.summary.companyPairsWithOverlap, pass: r3.summary.companyPairsWithOverlap === 1 });

    // Test 4: overlap details (via specific director)
    const t4 = toGraph(parseCSV(`A,X\nB,X\nA,Y\n`)); // Overlap X-Y via A only
    const r4 = genReport(t4);
    const pairXY = r4.highOverlapPairs.find(p => p.pair === 'X ↔ Y' || p.pair === 'Y ↔ X');
    results.push({ test: "overlap via list exists", expect: true, got: Boolean(pairXY), pass: Boolean(pairXY) });
    results.push({ test: "overlap count correct", expect: 1, got: pairXY ? pairXY.shared : null, pass: pairXY ? pairXY.shared === 1 : false });
    results.push({ test: "overlap via contains A", expect: true, got: pairXY ? pairXY.via.includes('A') : null, pass: pairXY ? pairXY.via.includes('A') : false });

    // Test 5: empty dataset yields zeros
    const t5 = toGraph(parseCSV(""));
    const r5 = genReport(t5);
    results.push({ test: "empty rows -> zero counts", expect: { companies: 0, directors: 0, seats: 0 }, got: { companies: r5.summary.totalCompanies, directors: r5.summary.totalDirectors, seats: r5.summary.totalBoardSeats }, pass: r5.summary.totalCompanies === 0 && r5.summary.totalDirectors === 0 && r5.summary.totalBoardSeats === 0 });

    // Test 6: parser trims/ignores blank lines
    const t6Input = `\n\n  A , X  \n\nB,  Y \n`;
    const t6 = parseCSV(t6Input);
    results.push({ test: "parser trims and ignores blanks", expectRows: 2, gotRows: t6.length, pass: t6.length === 2 });

    // Test 7: no overlaps when no shared directors
    const t7 = toGraph(parseCSV(`A,X\nB,Y\nC,Z\n`));
    const r7 = genReport(t7);
    results.push({ test: "no overlaps", expect: 0, got: r7.summary.companyPairsWithOverlap, pass: r7.summary.companyPairsWithOverlap === 0 });

    setTestLog(JSON.stringify({ results }, null, 2));
    setShowDebug(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2 font-semibold text-xl">
            <span className="inline-flex items-center justify-center rounded-2xl bg-blue-600 text-white h-9 w-9">ID</span>
            <span>Interlocking Directors Analyzer</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportPNG} className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 bg-slate-900 text-white hover:opacity-90 shadow">
              <Download className="h-4 w-4"/> Export PNG
            </button>
            <button onClick={exportReportCSV} className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50">
              <FileDown className="h-4 w-4"/> Report CSV
            </button>
            <button onClick={runSelfChecks} className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50">
              <Bug className="h-4 w-4"/> Run self-checks
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Controls */}
        <section className="lg:col-span-1 space-y-4">
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
            <label className="block text-sm text-slate-700">Minimum degree</label>
            <input
              type="range"
              min={0}
              max={10}
              value={minDegree}
              onChange={(e) => setMinDegree(parseInt(e.target.value || "0", 10))}
              className="w-full"
            />
            <div className="text-sm text-slate-600">Showing nodes with degree ≥ <span className="font-semibold">{minDegree}</span></div>

            {/* Legend */}
            <div className="pt-2">
              <div className="text-sm font-semibold mb-2">Legend</div>
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
              <p className="text-xs text-slate-500 mt-2">Dot size scales with number of boards served.</p>
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

          {/* Debug Panel */}
          {showDebug && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-2">
              <div className="flex items-center gap-2 text-slate-700"><Bug className="h-4 w-4"/> Self-check results</div>
              <pre className="text-xs bg-slate-100 rounded-xl p-2 overflow-auto max-h-48">{testLog || "No results yet."}</pre>
            </div>
          )}
        </section>

        {/* Right: Graph */}
        <section className="lg:col-span-2">
          <div className="bg-white rounded-2xl shadow p-2 h-[72vh]">
            <div ref={containerRef} className="h-full w-full rounded-2xl" />
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-6 text-xs text-slate-500">
        Built with <span className="font-mono">vis-network</span>. Paste your data and export the visualization &amp; report. No upload leaves your browser.
      </footer>
    </div>
  );
}
