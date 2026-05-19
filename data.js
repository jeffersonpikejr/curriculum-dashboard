// ============================================================================
// data.js — Curriculum content
//
// Edit this file to change topics, books, weekly plans, syntopic clusters,
// or your reading targets. The dashboard re-renders from this file on every
// page load.
//
// Conventions:
//   - weekKey(monthIdx, weekNum) — month 0 = May 2026, weekNum 1-4
//   - mo: [0,1,...] — months in which a topic/sub-topic is active
//   - Books appear in BOOK_PROGRESS to be tracked with per-week targets;
//     reference them via `progressKey` in topic.readings
// ============================================================================

// ── DATE LOGIC ──
// Curriculum anchor: May 2026 = month index 0. All "current X" values are
// derived from the real-time Date so the dashboard reflects today
// automatically. The dashboard's view-state (S.viewDate) can shift the
// rendered "current" for backdating; see VIEW_INFO usage in app.js.

// Months in curriculum (May 2026 → Jun 2027)
const ML = ["M","J","J","A","S","O","N","D","J","F","M","A","M","J"];
const MF = ["May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];
const MY = [2026,2026,2026,2026,2026,2026,2026,2026,2027,2027,2027,2027,2027,2027];

// Week index helpers — convert "May W3" → global week index
function weekKey(mIdx, wNum) { return `${mIdx}-W${wNum}`; }

// Map a real Date → curriculum month index (May 2026 = 0)
function dateToMonthIdx(d) {
  const months = (d.getFullYear() - 2026) * 12 + (d.getMonth() - 4); // May = JS month 4
  return Math.max(0, Math.min(MF.length - 1, months));
}
function dateToWeekOfMonth(d) {
  // Quartile the month into 4 weeks: days 1-7=W1, 8-14=W2, 15-21=W3, 22+=W4
  return Math.max(1, Math.min(4, Math.floor((d.getDate() - 1) / 7) + 1));
}

const _NOW = new Date();
const TODAY = { year: _NOW.getFullYear(), month: _NOW.getMonth() + 1, day: _NOW.getDate() };
const CURRENT_MONTH_IDX = dateToMonthIdx(_NOW);
const CURRENT_WEEK_OF_MONTH = dateToWeekOfMonth(_NOW);
const CURRENT_WEEK_KEY = weekKey(CURRENT_MONTH_IDX, CURRENT_WEEK_OF_MONTH);

const TIER = {1:"Sprint",2:"Core",3:"Ongoing",4:"Project"};
function tierOf(id){return [7,2].includes(id)?1:[1,9,6].includes(id)?2:[3,5].includes(id)?3:4;}

// ── READING PROGRESS ──
// Each book: total pages, current page, target end (month, week), priority chapters
const BOOK_PROGRESS = {
  "memory-craft": {
    title: "Memory Craft", author: "Lynne Kelly",
    totalPages: 288, currentPage: 79,
    startWeek: weekKey(0, 1), endWeek: weekKey(1, 4), // May W1 → Jun W4
    topic: 7,
  },
  "fda-adaptive": {
    title: "FDA Guidance: Adaptive Designs for Clinical Trials", author: "FDA CDER (2019)",
    totalPages: 30, currentPage: 12, // mid-progress at May W3
    startWeek: weekKey(0, 1), endWeek: weekKey(0, 4),
    topic: 2,
    note: "In progress",
  },
  "friedman": {
    title: "Fundamentals of Clinical Trials (5th ed.)", author: "Friedman, Furberg, DeMets",
    totalPages: 80, currentPage: 0, // priority chapters only (full book is 537 pp)
    // Selective: priority chapters total ~80 pp (ch.8 reduced to skim-only)
    priorityChapters: [
      {ch: 1, name: "Introduction to Clinical Trials", pages: "1-18", count: 18},
      {ch: 3, name: "What Is the Question?", pages: "49-67", count: 18},
      {ch: 4, name: "Study Population", pages: "73-86", count: 13},
      {ch: 5, name: "Basic Study Design", pages: "89-115", count: 26},
      {ch: 8, name: "Sample Size (SKIM — Fundamental Point + summary)", pages: "165-195", count: 5},
    ],
    skipChapters: [2, 6, 7, 9, 10, 11, 14, 16, 17, 19, 21],
    secondaryChapters: [
      {ch: 12, name: "Assessment and Reporting of Harm", pages: "255-274", count: 19},
      {ch: 13, name: "Assessment of HRQL", pages: "279-292", count: 13},
      {ch: 15, name: "Survival Analysis", pages: "315-340", count: 25},
      {ch: 18, name: "Issues in Data Analysis", pages: "403-453", count: 50},
      {ch: 20, name: "Reporting and Interpreting Results", pages: "479-494", count: 15},
      {ch: 22, name: "Regulatory Issues", pages: "515-538", count: 23},
    ],
    priorityTotalPages: 80,
    startWeek: weekKey(0, 4), endWeek: weekKey(2, 2), // May W4 → Jul W2
    topic: 2,
    note: "Priority chapters only · full book is 537 pp",
  },
  "raps-guidance": {
    title: "RAPS Regulatory Affairs Fundamentals", author: "RAPS (39-ch reference)",
    totalPages: 116, // selective: priority chapter sum (treating 'totalPages' as priority scope)
    currentPage: 0,
    // BD/strategy priority cut from 754-page reference
    priorityChapters: [
      {ch: 1, name: "FDA and Related Regulatory Agencies", pages: "1-40", count: 40},
      {ch: 3, name: "Regulatory Pathways (Drug/Biologic/Device/Combo)", pages: "53-84", count: 32},
      {ch: 4, name: "FDA Communications and Meetings", pages: "85-96", count: 12},
      {ch: 5, name: "Preparing for FDA Advisory Committee Meetings", pages: "97-106", count: 10},
      {ch: 10, name: "Regulatory Strategy", pages: "179-186", count: 8},
      {ch: 17, name: "Patents and Exclusivity", pages: "277-290", count: 14},
    ],
    secondaryChapters: [
      {ch: 11, name: "Master Protocol (adaptive/platform)", pages: "187-194", count: 8},
      {ch: 27, name: "Biosimilars (if asset-relevant)", pages: "429-450", count: 22},
      {ch: 37, name: "Pediatric Drug and Device Development", pages: "599-614", count: 16},
    ],
    skipChapters: [2, 6, 7, 8, 9, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39],
    priorityTotalPages: 116,
    startWeek: weekKey(1, 3), endWeek: weekKey(2, 4), // Jun W3 → Jul W4
    topic: 2,
    note: "BD-lens selective cut from 754-page reference",
  },
  "bogdan-villiger": {
    title: "Valuation in Life Sciences (3rd ed.)", author: "Bogdan & Villiger",
    totalPages: 360, currentPage: 0,
    startWeek: weekKey(2, 3), endWeek: weekKey(4, 4), // Jul W3 → Sep W4 (pushed from Jul W1)
    topic: 2,
  },
  "make-it-stick": {
    title: "Make It Stick", author: "Brown, Roediger & McDaniel",
    totalPages: 200, currentPage: 0, // selective ch.1-8, ~200pp of 290
    startWeek: weekKey(0, 3), endWeek: weekKey(1, 4), // May W3 → Jun W4
    topic: 7,
    note: "Selective ch.1-8",
  },
  "outlive-cardio": {
    title: "Outlive (cardio chapters)", author: "Peter Attia",
    totalPages: 80, currentPage: 0,
    startWeek: weekKey(0, 2), endWeek: weekKey(1, 4), // May W2 → Jun W4
    topic: 3,
    note: "Q2 cardio chunk — metabolic chapters in Aug, longevity in Jan",
  },
  "salt-fat-acid-heat": {
    title: "Salt, Fat, Acid, Heat", author: "Samin Nosrat",
    totalPages: 200, currentPage: 0,
    startWeek: weekKey(0, 1), endWeek: weekKey(7, 4), // May W1 → Dec W4 (ambient/reference)
    topic: 8,
    note: "Reference/skill book — ambient pace",
  },
  "food-lab": {
    title: "The Food Lab (selective)", author: "J. Kenji López-Alt",
    totalPages: 110, currentPage: 0,
    startWeek: weekKey(0, 1), endWeek: weekKey(7, 4), // May W1 → Dec W4 (ambient/reference)
    topic: 8,
    note: "Knife skills + sauces + rotating techniques · ambient pace",
  },
  "story-mckee": {
    title: "Story", author: "Robert McKee",
    totalPages: 380, currentPage: 0,
    startWeek: weekKey(1, 1), endWeek: weekKey(3, 4), // Jun W1 → Aug W4 (extended from Jul W4)
    topic: 6,
  },
  "mearsheimer": {
    title: "The Tragedy of Great Power Politics", author: "John Mearsheimer",
    totalPages: 400, currentPage: 0,
    startWeek: weekKey(1, 1), endWeek: weekKey(4, 4), // Jun W1 → Sep W4 (extended slow burn)
    topic: 5,
    note: "Slow burn — extended end date for sustainable pace",
  },
};

// ── SYNTOPIC CLUSTERS ──
const SYNTOPIC_CLUSTERS = {
  2: [ // Drug Dev clusters
    {
      title: "Cluster 1 — Trial Architecture & Regulatory Strategy",
      desc: "Foundational frameworks for trial design and FDA interaction. Read in parallel for syntopic synthesis.",
      span: "May–Jul 2026",
      items: [
        {title: "FDA Adaptive Designs Guidance (2019)", meta: "30 pp · May W1-4 (in progress)"},
        {title: "Friedman ch. 1, 3, 4, 5 priority + ch. 8 skim", meta: "80 pp · May W4–Jul W2"},
        {title: "RAPS — Ch. 1 + 10 (early); Ch. 3, 4, 5, 17 (Aug)", meta: "116 pp · staggered Jun W3–Aug"},
        {title: "FDA PRO/COA Guidance + ATTR endpoint precedents", meta: "Jun W3-4"},
        {title: "Alnylam patisiran FDA review docs", meta: "Jul W1-2"},
      ],
    },
    {
      title: "Cluster 2 — Valuation & Deal Architecture",
      desc: "rNPV foundations → full DCF/options → deal structuring. Pushed Bogdan to Jul W3 to relieve July reading peak.",
      span: "Jul W3–Dec 2026",
      items: [
        {title: "Stewart, Allison & Johnson (2001) — rNPV foundations", meta: "5 pp · May W3 ✓"},
        {title: "Bogdan & Villiger — Valuation in Life Sciences", meta: "~360 pp · Jul W3–Sep W4"},
        {title: "Pharma & Biotech M&A Playbook (case studies)", meta: "Aug–Sep"},
        {title: "Alnylam-Roche, Alnylam-Regeneron deal docs", meta: "Sep W1-2"},
      ],
    },
    {
      title: "Cluster 3 — Competitive Dynamics",
      desc: "CI frameworks applied to ATTR-CM and rare disease landscapes.",
      span: "Sep 2026–Feb 2027",
      items: [
        {title: "Evaluate Pharma + Cortellis competitive reports", meta: "Sep–Oct"},
        {title: "Industry analyses + expert network transcripts", meta: "Oct–Nov"},
        {title: "Friedman ch. 12, 18, 20 (outcomes & analysis)", meta: "Secondary · 84 pp"},
      ],
    },
  ],
  7: [ // Memory clusters
    {
      title: "Memory Infrastructure",
      desc: "Build the cognitive tools that accelerate every other topic. Memory Craft anchors, Make It Stick reinforces.",
      span: "May–Jun 2026",
      items: [
        {title: "Memory Craft (Kelly) — current: p.79 of 288", meta: "May W1–Jun W4"},
        {title: "Make It Stick (Brown et al.)", meta: "May W3–Jun W4"},
        {title: "Anki Manual + SuperMemo 20 Rules", meta: "May W1-2"},
      ],
    },
  ],
};

// ── TOPICS ──
const T = [
  {id:7, title:"Memory-Maxxing", color:"var(--t7)", bg:"var(--t7bg)",
   scope:"Narrow / Technique-based skill acquisition.",
   tf:"May–Jun 2026", burn:"Short burn — 4 weeks",
   practice:"Apply immediately to other topics. Build Anki decks for #2. Memory palace for #9 reading. Track recall quantitatively.",
   notes:"FRONT-LOAD. Infrastructure for entire curriculum. Success = invisible tool, not subject of study.",
   subs:[
     {l:"A",n:"Method of Loci",f:"Build 3-5 memory palaces",mo:[0,1],
      weeks:[
        {w:"May W1",wk:weekKey(0,1),focus:"Palace construction + indigenous memory systems",res:"Memory Craft ch.1-6",pages:"~50 pp",del:"First palace built (home layout)"},
        {w:"May W2",wk:weekKey(0,2),focus:"Encoding + retrieval across palace types",res:"Memory Craft ch.7-12",pages:"~50 pp",del:"Second palace (office), 50-item test"},
        {w:"May W3",wk:weekKey(0,3),focus:"Speed + accuracy drills",res:"Memory Craft + Make It Stick ch.1-2",pages:"~40 pp",del:"Third palace, timed retrieval benchmarks"},
        {w:"May W4",wk:weekKey(0,4),focus:"Integration begins",res:"Memory Craft + Make It Stick ch.3-4",pages:"~40 pp",del:"Apply to first #2 material"},
        {w:"Jun W1",wk:weekKey(1,1),focus:"Apply to #2 drug dev material",res:"Make It Stick ch.5-6",pages:"~35 pp",del:"Encode 20 pharma parameters from Stewart"},
        {w:"Jun W2",wk:weekKey(1,2),focus:"Integration deepens",res:"Make It Stick ch.7-8",pages:"~35 pp",del:"Memory palace for Friedman ch.1"},
      ]},
     {l:"B",n:"Spaced Repetition (Anki)",f:"System setup, card design, daily habit",mo:[0,1],
      weeks:[
        {w:"May W1",wk:weekKey(0,1),focus:"Anki setup + SuperMemo 20 rules",res:"Anki Manual + 20 Rules",pages:"~30 pp",del:"Deck structure designed, first 30 cards"},
        {w:"May W2",wk:weekKey(0,2),focus:"Card design patterns",res:"Anki community best practices",pages:"~20 pp",del:"Stewart rNPV deck complete (25 cards)",done:true},
        {w:"May W3",wk:weekKey(0,3),focus:"Daily review habit formation",res:"Atomic Habits habit stacking",pages:"~20 pp",del:"7-day streak, retention rate logged"},
        {w:"May W4",wk:weekKey(0,4),focus:"Integration — cards from all active topics",res:"Self-generated from #2 + #7 readings",pages:"—",del:"100+ cards across topics, retention >85%"},
        {w:"Jun W1-4",wk:weekKey(1,1),focus:"Sustained practice + refinement",res:"Daily review + new card creation",pages:"—",del:"Daily streak maintained, retention tracked"},
      ]},
     {l:"C",n:"Elaborative Encoding + Chunking",f:"Link new info to existing structures; pattern grouping",mo:[0,1],
      weeks:[
        {w:"May W3-4",wk:weekKey(0,3),focus:"Encoding techniques: stories, analogies, spatial",res:"Make It Stick ch.2-3",pages:"~25 pp",del:"Encode 10 #2 concepts using elaboration"},
        {w:"Jun W1-2",wk:weekKey(1,1),focus:"Chunking in domain-specific contexts",res:"Make It Stick ch.4 + chess pattern lit",pages:"~25 pp",del:"Chunk map for rNPV framework"},
      ]},
   ],
   readings:[
     {t:"Memory Craft",a:"Lynne Kelly",type:"BOOK",when:"May W1-Jun W4",progressKey:"memory-craft"},
     {t:"Make It Stick",a:"Brown, Roediger & McDaniel",type:"BOOK",when:"May W3-Jun W4",progressKey:"make-it-stick"},
     {t:"Anki Manual + SuperMemo 20 Rules",a:"Community",type:"GUIDE",when:"May W1"},
   ],
   mo:[0,1]},

  {id:2, title:"Drug Dev & LS Business Strategy", color:"var(--t2)", bg:"var(--t2bg)",
   scope:"Narrow. Professional mastery gap-fill — clinical dev strategy & operations.",
   tf:"May–Dec 2026", burn:"6-month sprint — career-critical",
   practice:"Case method: real pipeline asset → development plan → pressure-test as if presenting to dev committee. Expert network calls = live oral exams.",
   notes:"Career-critical sprint. Started with FDA Adaptive Designs (in progress) + Stewart rNPV paper (complete). Friedman priority chapters next. RAPS staggered to smooth July reading peak. Bogdan & Villiger pushed to Jul W3 start.",
   subs:[
     {l:"A",n:"Trial Design + Regulatory Strategy",f:"Adaptive designs, endpoints, FDA interaction, IND/NDA",mo:[0,1,2,3,4,5],
      weeks:[
        {w:"May W1-2",wk:weekKey(0,1),focus:"Adaptive trial design frameworks",res:"FDA Adaptive Designs Guidance — in progress",pages:"30 pp (~12 done)",del:"Adaptive design decision tree for vault"},
        {w:"May W3",wk:weekKey(0,3),focus:"rNPV valuation foundations",res:"Stewart et al. (2001) ✓",pages:"5 pp ✓",del:"25 Anki cards, rV/rNPV equations internalized",done:true},
        {w:"May W4",wk:weekKey(0,4),focus:"Trial design fundamentals begin",res:"Friedman ch.1 (Introduction to Clinical Trials)",pages:"18 pp",del:"Trial taxonomy note"},
        {w:"Jun W1",wk:weekKey(1,1),focus:"The question + study population",res:"Friedman ch.3 + ch.4",pages:"31 pp",del:"Question framing + population framework"},
        {w:"Jun W2",wk:weekKey(1,2),focus:"Basic study design",res:"Friedman ch.5",pages:"26 pp",del:"Study design taxonomy note"},
        {w:"Jun W3",wk:weekKey(1,3),focus:"RAPS regulatory landscape (early load)",res:"RAPS ch.1 (FDA & Related Agencies) + ch.10 (Regulatory Strategy)",pages:"48 pp",del:"FDA org map + regulatory strategy framework"},
        {w:"Jun W4",wk:weekKey(1,4),focus:"Endpoint strategy + sample size skim",res:"FDA PRO/COA + Friedman ch.8 (Fundamental Point + summary only)",pages:"~15 pp",del:"Endpoint framework + sample size decision tree"},
        {w:"Jul W1",wk:weekKey(2,1),focus:"Regulatory case study: Alnylam patisiran",res:"FDA review docs + advisory committee transcripts",pages:"~30 pp",del:"Case write-up: patisiran regulatory strategy"},
        {w:"Jul W2",wk:weekKey(2,2),focus:"Single-pivotal-trial guidance implications",res:"FDA single-pivotal guidance + LS Edge notes",pages:"~25 pp",del:"Single-pivotal feasibility assessment"},
        {w:"Jul W3-4",wk:weekKey(2,3),focus:"Integration: design a trial from scratch",res:"All prior materials",pages:"—",del:"Phase 2/3 trial design draft for ATTR asset"},
        {w:"Aug W1",wk:weekKey(3,1),focus:"RAPS pathway selection deep dive",res:"RAPS ch.3 (Regulatory Pathways) + ch.4 (FDA Communications)",pages:"44 pp",del:"Pathway selection decision tree"},
        {w:"Aug W2",wk:weekKey(3,2),focus:"AdCom prep + IP/exclusivity",res:"RAPS ch.5 (AdCom Prep) + ch.17 (Patents & Exclusivity)",pages:"24 pp",del:"AdCom playbook + exclusivity timing note"},
        {w:"Aug W3-4",wk:weekKey(3,3),focus:"Trial design capstone",res:"Synthesize all regulatory + design materials",pages:"—",del:"Full Phase 2/3 trial design w/ regulatory strategy"},
        {w:"Sep W1-4",wk:weekKey(4,1),focus:"Regulatory strategy oral prep",res:"Expert network call prep",pages:"—",del:"Talking points for consulting calls"},
        {w:"Oct",wk:weekKey(5,1),focus:"Ongoing review + emerging guidance",res:"New FDA guidances",pages:"—",del:"Updated vault notes"},
      ]},
     {l:"B",n:"Portfolio / Pipeline Valuation + Deal Architecture",f:"rNPV, milestones, optionality, partner alignment",mo:[2,3,4,5,6,7],
      weeks:[
        {w:"Jul W3-4",wk:weekKey(2,3),focus:"rNPV to full DCF: bridging the gap",res:"Bogdan & Villiger ch.1-4",pages:"~80 pp",del:"DCF vs. rNPV comparison note"},
        {w:"Aug W1-2",wk:weekKey(3,1),focus:"Real options in biotech valuation",res:"Bogdan & Villiger ch.5-8",pages:"~80 pp",del:"Options framework note"},
        {w:"Aug W3-4",wk:weekKey(3,3),focus:"Deal structure mechanics",res:"Bogdan & Villiger ch.9-12",pages:"~80 pp",del:"Deal term taxonomy"},
        {w:"Sep W1-2",wk:weekKey(4,1),focus:"Milestone + royalty structuring",res:"Bogdan & Villiger remainder + Pharma & Biotech M&A Playbook",pages:"~80 pp",del:"Milestone structure template"},
        {w:"Sep W3-4",wk:weekKey(4,3),focus:"Partner incentive alignment",res:"Alnylam-Roche, Alnylam-Regeneron case docs",pages:"~30 pp",del:"Incentive alignment framework"},
        {w:"Oct W1-2",wk:weekKey(5,1),focus:"Portfolio prioritization frameworks",res:"M&A Playbook continued",pages:"~30 pp",del:"Portfolio scoring model draft"},
        {w:"Oct W3-Nov",wk:weekKey(5,3),focus:"Integration: valuation case from scratch",res:"All prior + public pipeline data",pages:"—",del:"Full rNPV valuation of target asset"},
        {w:"Dec",wk:weekKey(7,1),focus:"Deal architecture capstone",res:"Synthesize all materials",pages:"—",del:"Deal term sheet mock-up for in-license"},
      ]},
     {l:"C",n:"Competitive Dynamics",f:"CI frameworks for specialty pharma / rare disease",mo:[4,5,6,7,8,9],
      weeks:[
        {w:"Sep W1-2",wk:weekKey(4,1),focus:"CI framework foundations + vendor landscape",res:"Evaluate Pharma + Cortellis reports",pages:"—",del:"CI framework taxonomy note"},
        {w:"Sep W3-4",wk:weekKey(4,3),focus:"ATTR-CM competitive landscape mapping",res:"Evaluate Pharma + Cortellis competitive reports",pages:"—",del:"ATTR-CM landscape map"},
        {w:"Oct W1-2",wk:weekKey(5,1),focus:"Friedman secondary: outcomes & harm assessment",res:"Friedman ch.12, ch.20",pages:"34 pp",del:"Outcomes assessment framework"},
        {w:"Oct W3-4",wk:weekKey(5,3),focus:"Competitive scenario planning",res:"War-gaming + LS Chess archetypes",pages:"—",del:"3-scenario competitive model"},
        {w:"Nov-Dec",wk:weekKey(6,1),focus:"Integration: full competitive brief",res:"All prior materials",pages:"—",del:"CI brief for BD committee"},
        {w:"Jan-Feb 2027",wk:weekKey(8,1),focus:"Ongoing landscape monitoring",res:"Emerging data + conferences",pages:"—",del:"Quarterly landscape updates"},
      ]},
   ],
   readings:[
     {t:"FDA Guidance: Adaptive Designs",a:"FDA CDER (2019)",type:"GUIDANCE",when:"May W1-2 (in progress)",progressKey:"fda-adaptive"},
     {t:"Putting a Price on Biotechnology",a:"Stewart, Allison & Johnson (2001)",type:"PAPER",when:"May W3 ✓"},
     {t:"Fundamentals of Clinical Trials (5th ed.)",a:"Friedman, Furberg, DeMets",type:"TEXTBOOK",when:"May W4–Jul W2 (priority ch. 1,3,4,5 + ch.8 skim)",progressKey:"friedman"},
     {t:"RAPS Regulatory Affairs Fundamentals",a:"RAPS (selective)",type:"GUIDE",when:"Jun W3–Aug W2 (priority ch. 1,3,4,5,10,17)",progressKey:"raps-guidance"},
     {t:"Valuation in Life Sciences (3rd ed.)",a:"Bogdan & Villiger",type:"TEXTBOOK",when:"Jul W3–Sep W4",progressKey:"bogdan-villiger"},
     {t:"The Pharma & Biotech M&A Playbook",a:"Deal case studies",type:"CASES",when:"Sep W1–Oct W2"},
   ],
   mo:[0,1,2,3,4,5,6,7]},

  {id:1, title:"Individual Greatness: Phenotypes & Tradeoffs", color:"var(--t1)", bg:"var(--t1bg)",
   scope:"Broad / Subdivided. Meta-framework informing all allocation decisions.",
   tf:"Aug 2026 – 2027+", burn:"Permanent slow burn",
   practice:"Atomic essays articulating evolving thesis. Test: can you articulate a coherent phenotype philosophy? Decision filter for time allocation.",
   notes:"Your Western Canon trunk. Stays indefinitely. Every allocation tradeoff across the other 9 topics should be answerable through this framework.",
   subs:[
     {l:"A",n:"Biological Constraints on Excellence",f:"Genetics, aging, tradeoff theory, ceiling effects",mo:[3,4,5,6,7],
      weeks:[
        {w:"Aug W1-2",wk:weekKey(3,1),focus:"Genetic determinism vs. plasticity",res:"Range ch.1-6 (Epstein)",pages:"~100 pp",del:"Specialist vs. generalist note"},
        {w:"Aug W3-4",wk:weekKey(3,3),focus:"Performance ceiling theory",res:"Range ch.7-12",pages:"~100 pp",del:"Ceiling effects framework"},
        {w:"Sep W1-2",wk:weekKey(4,1),focus:"Aging and peak performance windows",res:"Selected longevity research papers",pages:"—",del:"Peak window mapping for own domains"},
        {w:"Sep W3-Oct",wk:weekKey(4,3),focus:"Tradeoff theory synthesis",res:"Cross-reference with #3 materials",pages:"—",del:"Biological constraints essay"},
        {w:"Nov-Dec",wk:weekKey(6,1),focus:"Ongoing reading + reflection",res:"As encountered",pages:"—",del:"Monthly vault entries"},
      ]},
     {l:"B",n:"Historical Phenotype Studies",f:"What did greatness look like across eras?",mo:[5,6,7,8,9,10],
      weeks:[
        {w:"Oct W1-4",wk:weekKey(5,1),focus:"Roman models of excellence",res:"Seneca: Letters from a Stoic (selected)",pages:"~150 pp",del:"Stoic phenotype essay"},
        {w:"Nov W1-4",wk:weekKey(6,1),focus:"Greek/Roman comparative greatness",res:"Plutarch's Lives (selected pairs)",pages:"~200 pp",del:"Comparative greatness framework"},
        {w:"Dec W1-4",wk:weekKey(7,1),focus:"Renaissance/Machiavellian phenotype",res:"The Prince (Machiavelli)",pages:"~100 pp",del:"Power phenotype note"},
        {w:"Jan 2027",wk:weekKey(8,1),focus:"Nietzschean critique",res:"Genealogy of Morals",pages:"~120 pp",del:"Master/slave morality essay"},
        {w:"Feb-Mar",wk:weekKey(9,1),focus:"Synthesis across eras",res:"All prior",pages:"—",del:"Historical phenotypes meta-essay"},
      ]},
     {l:"C",n:"Personal Phenotype Architecture",f:"Your own tradeoff decisions",mo:[9,10,11,12,13],
      weeks:[
        {w:"Feb 2027",wk:weekKey(9,1),focus:"Map current phenotype",res:"Self-assessment + leverage log review",pages:"—",del:"Personal phenotype profile v1"},
        {w:"Mar",wk:weekKey(10,1),focus:"Identify optimization vectors",res:"Cross-reference all prior sub-topics",pages:"—",del:"Tradeoff decision matrix"},
        {w:"Apr-Jun",wk:weekKey(11,1),focus:"Iterative refinement",res:"Ongoing reflection",pages:"—",del:"Quarterly phenotype review ritual"},
      ]},
   ],
   readings:[
     {t:"Range: Why Generalists Triumph",a:"David Epstein",type:"BOOK",when:"Aug"},
     {t:"Letters from a Stoic",a:"Seneca (trans. Campbell)",type:"CLASSIC",when:"Oct"},
     {t:"Plutarch's Lives (selected)",a:"Plutarch",type:"CLASSIC",when:"Nov"},
     {t:"The Prince",a:"Machiavelli",type:"CLASSIC",when:"Dec"},
     {t:"The Genealogy of Morals",a:"Nietzsche",type:"CLASSIC",when:"Jan 2027"},
   ],
   mo:[3,4,5,6,7,8,9,10,11,12,13]},

  {id:9, title:"Classical Literature", color:"var(--t9)", bg:"var(--t9bg)",
   scope:"Broad / Curated. Great Books tailored to compound with #1, #6, #10.",
   tf:"Jul 2026 – 2027+", burn:"Permanent slow burn — 1 book / 2-3 weeks",
   practice:"Source notes + atomic notes. Every book → at least 1 insight connecting to #1. Feed observations into #6 and #10.",
   notes:"Three parallel reading threads. Don't rush — set cadence, not deadline. Reading list evolves as other topics reveal needs.",
   subs:[
     {l:"A",n:"Literature of Greatness (feeds #1)",f:"Excellence, power, ambition",mo:[2,3,4,5,6,7],
      weeks:[
        {w:"Jul W1-3",wk:weekKey(2,1),focus:"Seneca on time, ambition, death",res:"Letters from a Stoic (selected)",pages:"~150 pp",del:"Source note + 2 atomic notes"},
        {w:"Jul W4-Aug W2",wk:weekKey(2,4),focus:"Renaissance statecraft",res:"The Prince",pages:"~100 pp",del:"Source note + power phenotype link"},
        {w:"Aug W3-Sep W1",wk:weekKey(3,3),focus:"Comparative lives",res:"Plutarch: Alexander/Caesar pair",pages:"~120 pp",del:"Greatness pattern extraction"},
        {w:"Sep W2-Oct",wk:weekKey(4,2),focus:"Will to power",res:"Genealogy of Morals",pages:"~120 pp",del:"Master morality essay"},
      ]},
     {l:"B",n:"Literature of Storytelling (feeds #6)",f:"Narrative mastery across eras",mo:[5,6,7,8,9,10],
      weeks:[
        {w:"Oct W1-Nov W1",wk:weekKey(5,1),focus:"Foundational epic narrative",res:"The Iliad (Fagles)",pages:"~600 pp",del:"Narrative structure analysis"},
        {w:"Nov W2-Dec W2",wk:weekKey(6,2),focus:"Psychological realism",res:"The Brothers Karamazov",pages:"~700 pp",del:"Character construction notes"},
        {w:"Jan-Feb 2027",wk:weekKey(8,1),focus:"Dramatic structure",res:"Hamlet or King Lear",pages:"~250 pp",del:"Dramatic tension patterns"},
      ]},
     {l:"C",n:"Literature of Argument (feeds #10)",f:"Essay and non-fiction craft",mo:[8,9,10,11,12,13],
      weeks:[
        {w:"Jan 2027",wk:weekKey(8,1),focus:"The essay as form",res:"Montaigne: selected Essays",pages:"~200 pp",del:"Essay structure patterns"},
        {w:"Feb",wk:weekKey(9,1),focus:"Political clarity",res:"Orwell: selected essays",pages:"~150 pp",del:"Writing craft extraction"},
        {w:"Mar-Apr",wk:weekKey(10,1),focus:"New Journalism",res:"Slouching Towards Bethlehem (Didion)",pages:"~240 pp",del:"Voice/style analysis"},
      ]},
   ],
   readings:[
     {t:"Letters from a Stoic (selected)",a:"Seneca",type:"CLASSIC",when:"Jul W1-3"},
     {t:"The Prince",a:"Machiavelli",type:"CLASSIC",when:"Jul W4-Aug"},
     {t:"Plutarch's Lives (Alexander/Caesar)",a:"Plutarch",type:"CLASSIC",when:"Aug-Sep"},
     {t:"Genealogy of Morals",a:"Nietzsche",type:"CLASSIC",when:"Sep-Oct"},
     {t:"The Iliad",a:"Homer (Fagles)",type:"CLASSIC",when:"Oct-Nov"},
     {t:"The Brothers Karamazov",a:"Dostoevsky",type:"CLASSIC",when:"Nov-Dec"},
     {t:"Hamlet",a:"Shakespeare",type:"CLASSIC",when:"Jan-Feb 2027"},
     {t:"Essays (selected)",a:"Montaigne",type:"CLASSIC",when:"Jan 2027"},
     {t:"Selected Essays",a:"Orwell",type:"ESSAYS",when:"Feb 2027"},
     {t:"Slouching Towards Bethlehem",a:"Didion",type:"ESSAYS",when:"Mar-Apr 2027"},
   ],
   mo:[2,3,4,5,6,7,8,9,10,11,12,13]},

  {id:6, title:"Storytelling & Fiction Writing", color:"var(--t6)", bg:"var(--t6bg)",
   scope:"Narrow. Narrative craft as transferable communication skill.",
   tf:"Jun–Sep 2026", burn:"Medium burn — 4 months",
   practice:"Write finished pieces: 500+ word flash fiction, narrative essays. Share with Katherine or Substack. The stake matters.",
   notes:"Writing triad with #9 and #10. Compounds with professional communication and LS Chess content.",
   subs:[
     {l:"A",n:"Story Structure",f:"3-act, hero's journey, scene construction",mo:[1,2,3],
      weeks:[
        {w:"Jun W1-2",wk:weekKey(1,1),focus:"Story architecture foundations",res:"Story (McKee) Part 1",pages:"~75 pp",del:"Story structure cheat sheet"},
        {w:"Jun W3-4",wk:weekKey(1,3),focus:"Story Part 2 — structure deepening",res:"Story Part 2",pages:"~75 pp",del:"Beat sheet template"},
        {w:"Jul W1-2",wk:weekKey(2,1),focus:"Scene construction + turning points",res:"Story Part 3",pages:"~75 pp",del:"Scene analysis of favorite film"},
        {w:"Jul W3-4",wk:weekKey(2,3),focus:"Character + dramatic irony",res:"Story Part 4",pages:"~75 pp",del:"Character motivation template"},
        {w:"Aug W1-2",wk:weekKey(3,1),focus:"Hero's journey + monomyth",res:"Story Part 5 + Campbell refs",pages:"~80 pp",del:"Map monomyth onto personal narrative"},
        {w:"Aug W3-4",wk:weekKey(3,3),focus:"Integration: write structured short story",res:"All prior",pages:"—",del:"First complete short story (1500-2000w)"},
      ]},
     {l:"B",n:"Prose Style & Voice",f:"Sentence-level craft, rhythm, voice",mo:[3,4],
      weeks:[
        {w:"Sep W1-2",wk:weekKey(4,1),focus:"Sentence-level precision",res:"Several Short Sentences (Klinkenborg)",pages:"~200 pp",del:"Rewrite 3 paragraphs from own writing"},
        {w:"Sep W3-4",wk:weekKey(4,3),focus:"Voice development",res:"On Writing (King) Part 1-2",pages:"~150 pp",del:"Voice study: 3 writers you admire"},
      ]},
     {l:"C",n:"Character & Persuasion",f:"Character psychology, narrative persuasion",mo:[4,5],
      weeks:[
        {w:"Oct W1-2",wk:weekKey(5,1),focus:"Rhythm and compression",res:"On Writing Part 3-4",pages:"~120 pp",del:"Flash fiction (500w) on voice"},
        {w:"Oct W3-4",wk:weekKey(5,3),focus:"Capstone: complete narrative piece",res:"All prior materials",pages:"—",del:"Final polished piece (2000w+)"},
      ]},
   ],
   readings:[
     {t:"Story",a:"Robert McKee",type:"BOOK",when:"Jun-Aug",progressKey:"story-mckee"},
     {t:"Several Short Sentences About Writing",a:"Verlyn Klinkenborg",type:"BOOK",when:"Sep"},
     {t:"On Writing",a:"Stephen King",type:"BOOK",when:"Sep-Oct"},
   ],
   mo:[1,2,3,4,5]},

  {id:3, title:"Health, Fitness & Longevity", color:"var(--t3)", bg:"var(--t3bg)",
   scope:"Broad / Rotate quarterly.",
   tf:"Ongoing", burn:"Medium — 1 sub-domain per quarter",
   practice:"Body is the lab. Design protocols, track in health logger. N=1 experiment notes in vault.",
   notes:"Nutrition science absorbed here. Cooking (#8) stays separate. Quarterly rotation keeps it fresh.",
   subs:[
     {l:"A",n:"Exercise Physiology (Q2 2026)",f:"VO2max, strength programming, periodization",mo:[0,1,2],
      weeks:[
        {w:"May-Jun",wk:weekKey(0,3),focus:"VO2max + zone 2 science",res:"Outlive (Attia) cardio chapters",pages:"~80 pp",del:"VO2max protocol design"},
        {w:"Jul",wk:weekKey(2,1),focus:"Periodization models",res:"Science & Practice of Strength Training ch.1-8",pages:"~120 pp",del:"Next training block designed"},
      ]},
     {l:"B",n:"Metabolic Health & Biomarkers (Q3 2026)",f:"Glucose, lipids, inflammation, testing",mo:[3,4,5],
      weeks:[
        {w:"Aug-Sep",wk:weekKey(3,1),focus:"Biomarker interpretation + testing",res:"Outlive metabolic chapters",pages:"~100 pp",del:"Personal biomarker dashboard"},
        {w:"Oct",wk:weekKey(5,1),focus:"Metabolic optimization",res:"Selected research papers",pages:"—",del:"Metabolic protocol adjustments"},
      ]},
     {l:"C",n:"Sleep & Recovery (Q4 2026)",f:"Sleep staging, HRV, circadian",mo:[6,7],
      weeks:[
        {w:"Nov-Dec",wk:weekKey(6,1),focus:"Sleep architecture + recovery",res:"Why We Sleep (Walker)",pages:"~360 pp",del:"Sleep protocol + tracking system"},
      ]},
     {l:"D",n:"Longevity Mechanisms (Q1 2027)",f:"Senescence, mTOR, CR, rapamycin",mo:[8,9,10],
      weeks:[
        {w:"Jan-Mar 2027",wk:weekKey(8,1),focus:"Longevity science deep dive",res:"Outlive longevity ch. + primary lit",pages:"~150 pp",del:"Longevity framework + protocol"},
      ]},
   ],
   readings:[
     {t:"Outlive",a:"Peter Attia",type:"BOOK",when:"May-Jun cardio chunk · Aug metabolic · Jan 2027 longevity",progressKey:"outlive-cardio"},
     {t:"Science & Practice of Strength Training",a:"Zatsiorsky & Kraemer",type:"TEXTBOOK",when:"Jul"},
     {t:"Why We Sleep",a:"Matthew Walker",type:"BOOK",when:"Nov-Dec"},
   ],
   mo:[0,1,2,3,4,5,6,7,8,9,10,11,12,13]},

  {id:4, title:"Survival & Emergency Preparedness", color:"var(--t4)", bg:"var(--t4bg)",
   scope:"Narrow / Question-driven. Three projects, then archive.",
   tf:"Jun–Nov 2026 (staggered)", burn:"Short burn — project-based",
   practice:"Build the kit. Run the drill. Write the plan. If you haven't physically done it, you haven't learned it.",
   notes:"Highest risk of YouTube rabbit holes. Constrain ruthlessly. Three questions, three projects, done. Annual refresh.",
   subs:[
     {l:"A",n:"72h / No Power",f:"Can I sustain household 72h without utilities?",mo:[1,2],
      weeks:[
        {w:"Jun W1-2",wk:weekKey(1,1),focus:"Inventory + gap analysis",res:"FEMA Ready.gov checklist",pages:"~20 pp",del:"Gap list + budget"},
        {w:"Jun W3-Jul W1",wk:weekKey(1,3),focus:"Build kit",res:"SAS Survival Handbook (selected)",pages:"~50 pp",del:"72h kit complete and staged"},
        {w:"Jul W2",wk:weekKey(2,2),focus:"Dry run: power outage simulation",res:"None — execution",pages:"—",del:"After-action report"},
      ]},
     {l:"B",n:"First Aid / TCCC Basics",f:"Can I provide emergency medical care?",mo:[4,5],
      weeks:[
        {w:"Sep W1-2",wk:weekKey(4,1),focus:"TCCC principles + hemorrhage control",res:"TCCC Guidelines + Stop the Bleed",pages:"~40 pp",del:"Complete Stop the Bleed course"},
        {w:"Sep W3-Oct W1",wk:weekKey(4,3),focus:"Medical kit + practice",res:"NAEMT TCCC materials",pages:"~30 pp",del:"IFAK assembled + drill proficiency"},
        {w:"Oct W2",wk:weekKey(5,2),focus:"Scenario drill",res:"None — execution",pages:"—",del:"After-action report"},
      ]},
     {l:"C",n:"Comms + Evac Plan",f:"Communications + evacuation plan",mo:[5,6],
      weeks:[
        {w:"Oct W3-Nov W1",wk:weekKey(5,3),focus:"Comms plan: rally points, contacts",res:"FEMA family comms template",pages:"~10 pp",del:"Written plan shared with Katherine"},
        {w:"Nov W2-3",wk:weekKey(6,2),focus:"Evacuation routes + go-bag",res:"Local emergency mgmt maps",pages:"—",del:"3 routes mapped, go-bag packed"},
        {w:"Nov W4",wk:weekKey(6,4),focus:"Full household drill",res:"None — execution",pages:"—",del:"Final after-action → archive topic"},
      ]},
   ],
   readings:[
     {t:"SAS Survival Handbook",a:"Wiseman",type:"REFERENCE",when:"Jun-Jul"},
     {t:"TCCC Guidelines",a:"CoTCCC / NAEMT",type:"GUIDE",when:"Sep-Oct"},
     {t:"FEMA Ready.gov Plans",a:"FEMA",type:"GUIDE",when:"Jun + Oct-Nov"},
   ],
   mo:[1,2,4,5,6]},

  {id:5, title:"Decision-Making & Geopolitical Strategy", color:"var(--t5)", bg:"var(--t5bg)",
   scope:"Split: Geopolitics = slow burn. Decision Sci = 8-week intensive.",
   tf:"Jun 2026 – 2027+", burn:"Mixed",
   practice:"Decision journal with predictions, confidence intervals, calibration reviews. Geopolitics: situation assessments forcing a call.",
   notes:"Decision science is the most measurable topic. If calibration isn't improving, you're not learning. Geopolitics feeds macro investment thesis.",
   subs:[
     {l:"A",n:"Geopolitical Strategy (slow burn)",f:"Thucydides Trap, resources, demographics",mo:[1,2,3,4,5,6,7,8,9,10,11,12,13],
      weeks:[
        {w:"Jun-Sep",wk:weekKey(1,1),focus:"Great power competition frameworks",res:"Tragedy of Great Power Politics (Mearsheimer)",pages:"~400 pp · slow burn",del:"Offensive realism framework note"},
        {w:"Oct-Nov",wk:weekKey(5,1),focus:"Geographic determinism",res:"Prisoners of Geography (Marshall)",pages:"~300 pp",del:"Geographic constraints essay"},
        {w:"Dec onwards",wk:weekKey(7,1),focus:"Current events using frameworks",res:"FT / Economist / Foreign Affairs",pages:"—",del:"Monthly situation assessment (1pg)"},
      ]},
     {l:"B",n:"Decision Science (8-week intensive)",f:"Bayesian reasoning, EV, calibration, bias",mo:[3,4],
      weeks:[
        {w:"Aug W1-2",wk:weekKey(3,1),focus:"Calibration + forecasting foundations",res:"Superforecasting (Tetlock) ch.1-7",pages:"~150 pp",del:"Decision journal setup + first 10 predictions"},
        {w:"Aug W3-4",wk:weekKey(3,3),focus:"Forecasting technique refinement",res:"Superforecasting ch.8-14",pages:"~150 pp",del:"20 predictions logged"},
        {w:"Sep W1-2",wk:weekKey(4,1),focus:"Decision process architecture",res:"Thinking in Bets (Duke)",pages:"~250 pp",del:"Pre-mortem template + resulting note"},
        {w:"Sep W3-4",wk:weekKey(4,3),focus:"Calibration review + Bayesian updating",res:"Review own predictions + Bayes primer",pages:"—",del:"First calibration score + update log"},
        {w:"Oct W1-2",wk:weekKey(5,1),focus:"Cognitive bias deep dive",res:"Selected Kahneman/Tversky papers",pages:"~50 pp",del:"Personal bias inventory"},
        {w:"Oct W3-4",wk:weekKey(5,3),focus:"Integration: decision framework",res:"All prior",pages:"—",del:"Personal decision framework v1"},
      ]},
   ],
   readings:[
     {t:"Tragedy of Great Power Politics",a:"John Mearsheimer",type:"BOOK",when:"Jun-Sep (slow burn)",progressKey:"mearsheimer"},
     {t:"Prisoners of Geography",a:"Tim Marshall",type:"BOOK",when:"Oct-Nov"},
     {t:"Superforecasting",a:"Philip Tetlock",type:"BOOK",when:"Aug"},
     {t:"Thinking in Bets",a:"Annie Duke",type:"BOOK",when:"Sep"},
   ],
   mo:[1,2,3,4,5,6,7,8,9,10,11,12,13]},

  {id:8, title:"Nutrition, Food & Cooking", color:"var(--t8)", bg:"var(--t8bg)",
   scope:"Narrow / Practical skill. Culinary craft — nutrition science is in #3.",
   tf:"Ongoing — 1 cuisine + 1 technique / month", burn:"Low-intensity, no end date",
   practice:"Cook the thing. Dinner parties, new recipes weekly. Vault = recipe iterations.",
   notes:"Most naturally practice-driven topic. Kitchen is the classroom.",
   subs:[
     {l:"A",n:"Monthly Cuisine Rotation",f:"French → Japanese → Mexican → Italian → Thai...",mo:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
      weeks:[
        {w:"May",wk:weekKey(0,1),focus:"French fundamentals",res:"Salt Fat Acid Heat — Salt + Fat ch.",pages:"~100 pp",del:"3 French dishes executed"},
        {w:"Jun",wk:weekKey(1,1),focus:"Japanese precision",res:"Salt Fat Acid Heat — Acid ch.",pages:"~50 pp",del:"3 Japanese dishes"},
        {w:"Jul",wk:weekKey(2,1),focus:"Mexican depth",res:"Salt Fat Acid Heat — Heat ch.",pages:"~50 pp",del:"3 Mexican dishes"},
        {w:"Aug onwards",wk:weekKey(3,1),focus:"Rotating cuisines",res:"The Food Lab + specialized refs",pages:"—",del:"3 dishes/month minimum"},
      ]},
     {l:"B",n:"Monthly Technique Rotation",f:"Knife skills → sauces → fermentation → baking...",mo:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],
      weeks:[
        {w:"May",wk:weekKey(0,1),focus:"Knife skills + mise en place",res:"The Food Lab ch.1-2",pages:"~60 pp",del:"Brunoise + julienne benchmark"},
        {w:"Jun",wk:weekKey(1,1),focus:"Mother sauces",res:"The Food Lab sauce ch.",pages:"~50 pp",del:"5 mother sauces"},
        {w:"Jul onwards",wk:weekKey(2,1),focus:"Rotating techniques",res:"Specialized references",pages:"—",del:"1 technique/month"},
      ]},
   ],
   readings:[
     {t:"Salt, Fat, Acid, Heat",a:"Samin Nosrat",type:"BOOK",when:"May–Dec (ambient · 1 section/quarter)",progressKey:"salt-fat-acid-heat"},
     {t:"The Food Lab",a:"J. Kenji López-Alt",type:"BOOK",when:"May–Dec (ambient · rotating techniques)",progressKey:"food-lab"},
     {t:"Serious Eats",a:"Various",type:"RESOURCE",when:"Ongoing"},
   ],
   mo:[0,1,2,3,4,5,6,7,8,9,10,11,12,13]},

  {id:10, title:"Writing Non-Fiction", color:"var(--t10)", bg:"var(--t10bg)",
   scope:"Narrow by form. Essay writing — compounds with everything.",
   tf:"Nov 2026 – Mar 2027", burn:"Medium — 4 months",
   practice:"Weekly essay: 500-1000w from any of the other 9 topics. Publish on Substack or vault.",
   notes:"Writing cluster with #6 + #9. Highest-leverage intellectual compounding engine.",
   subs:[
     {l:"A",n:"Essay Structure & Argumentation",f:"Thesis, evidence, rhetoric",mo:[6,7],
      weeks:[
        {w:"Nov W1-2",wk:weekKey(6,1),focus:"Essay architecture",res:"On Writing Well (Zinsser) ch.1-10",pages:"~100 pp",del:"Essay structure template"},
        {w:"Nov W3-4",wk:weekKey(6,3),focus:"Argumentation + evidence",res:"On Writing Well ch.11-20",pages:"~120 pp",del:"First essay using template"},
        {w:"Dec W1-2",wk:weekKey(7,1),focus:"Rhetorical strategy",res:"Draft No. 4 (McPhee) ch.1-3",pages:"~80 pp",del:"Rhetorical toolkit note"},
        {w:"Dec W3-4",wk:weekKey(7,3),focus:"Long-form structure",res:"Draft No. 4 ch.4-6",pages:"~80 pp",del:"Long-form essay outline (2000w+)"},
      ]},
     {l:"B",n:"Revision Craft",f:"Editing, compression, clarity",mo:[8,9],
      weeks:[
        {w:"Jan W1-2",wk:weekKey(8,1),focus:"Radical compression",res:"Politics and the English Language (Orwell)",pages:"~30 pp",del:"Revise prior essay: cut 30%"},
        {w:"Jan W3-4",wk:weekKey(8,3),focus:"Voice refinement",res:"Re-read Klinkenborg",pages:"—",del:"Revised essay v2"},
        {w:"Feb",wk:weekKey(9,1),focus:"Self-editing workflow",res:"On Writing Well revision ch.",pages:"~60 pp",del:"Personal editing checklist"},
      ]},
     {l:"C",n:"Weekly Output Habit",f:"500-1000w/week from other subjects",mo:[6,7,8,9,10],
      weeks:[
        {w:"Nov onwards",wk:weekKey(6,1),focus:"Weekly essay output",res:"Topics from active curriculum",pages:"—",del:"1 essay/week archived in vault"},
        {w:"Mar 2027",wk:weekKey(10,1),focus:"Retrospective",res:"Own output",pages:"—",del:"Writing retrospective + style note"},
      ]},
   ],
   readings:[
     {t:"On Writing Well",a:"William Zinsser",type:"BOOK",when:"Nov"},
     {t:"Draft No. 4",a:"John McPhee",type:"BOOK",when:"Dec"},
     {t:"Politics and the English Language",a:"George Orwell",type:"ESSAY",when:"Jan 2027"},
   ],
   mo:[6,7,8,9,10]},
];