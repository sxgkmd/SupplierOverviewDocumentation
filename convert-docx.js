const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(
  path.join(__dirname, "extracted_guide.html"),
  "utf8"
);
const $ = cheerio.load(html);
const docsDir = path.join(__dirname, "docs");

// =============================================
// STEP 1: Parse the HTML into a structured tree
// =============================================

const allElements = $("body").children().toArray();

const sections = [];
let currentH1 = null;
let currentH2 = null;
let currentH3 = null;
let foundFirstH1 = false;

for (const el of allElements) {
  const tag = el.tagName;
  const text = $(el).text().trim();

  // Skip everything before the first h1 (title page + TOC)
  if (!foundFirstH1) {
    if (tag === "h1") foundFirstH1 = true;
    else continue;
  }

  if (tag === "h1") {
    currentH1 = { title: text, content: [], children: [] };
    sections.push(currentH1);
    currentH2 = null;
    currentH3 = null;
  } else if (tag === "h2") {
    currentH2 = { title: text, content: [], children: [] };
    if (currentH1) currentH1.children.push(currentH2);
    currentH3 = null;
  } else if (tag === "h3") {
    currentH3 = { title: text, content: [] };
    if (currentH2) currentH2.children.push(currentH3);
    else if (currentH1) currentH1.children.push(currentH3);
  } else {
    const target = currentH3 || currentH2 || currentH1;
    if (target) target.content.push(el);
  }
}

console.log(
  `Parsed ${sections.length} top-level sections:\n`
);
for (const s of sections) {
  console.log(
    ` [H1] "${s.title}" — ${s.content.length} content blocks, ${s.children.length} children`
  );
  for (const c of s.children) {
    console.log(
      `   [H2] "${c.title}" — ${c.content.length} content, ${(c.children || []).length} children`
    );
  }
}

// =============================================
// STEP 2: Convert HTML elements to markdown
// =============================================

function htmlToMarkdown(elements) {
  let md = "";
  for (const el of elements) {
    md += elementToMarkdown(el);
  }
  return md.trim();
}

function elementToMarkdown(el) {
  const tag = el.tagName;
  if (!tag) return $(el).text();

  if (tag === "p") {
    const inner = inlineContent(el);
    if (!inner.trim()) return "\n";
    return inner.trim() + "\n\n";
  }

  if (tag === "table") return tableToMarkdown(el) + "\n\n";
  if (tag === "ul" || tag === "ol") return listToMarkdown(el, tag) + "\n\n";
  if (tag === "br") return "\n";

  return inlineContent(el) + "\n\n";
}

function inlineContent(el) {
  let result = "";
  $(el)
    .contents()
    .each((i, child) => {
      if (child.type === "text") {
        result += $(child).text();
      } else if (child.tagName === "strong" || child.tagName === "b") {
        const inner = $(child).text();
        if (inner.trim()) result += `**${inner}**`;
      } else if (child.tagName === "em" || child.tagName === "i") {
        const inner = $(child).text();
        if (inner.trim()) result += `*${inner}*`;
      } else if (child.tagName === "img") {
        const src = $(child).attr("src");
        if (src) result += `\n\n![](${src})\n\n`;
      } else if (child.tagName === "a") {
        const href = $(child).attr("href") || "";
        const text = $(child).text().trim();
        if (href.startsWith("#")) {
          result += text;
        } else if (href) {
          result += `[${text}](${href})`;
        } else {
          result += text;
        }
      } else if (child.tagName === "br") {
        result += "  \n";
      } else {
        result += inlineContent(child);
      }
    });
  return result;
}

function tableToMarkdown(tableEl) {
  const rows = [];
  $(tableEl)
    .find("tr")
    .each((i, tr) => {
      const cells = [];
      $(tr)
        .find("td, th")
        .each((j, td) => {
          cells.push(deepCellContent(td));
        });
      rows.push(cells);
    });

  if (rows.length === 0) return "";

  // Detect step table: first cell of every row is a number (with optional letter/decimal)
  const isStepTable = rows.every(
    (row) =>
      row.length >= 2 &&
      /^\d+(\.\d+)?[a-z]?$|^…$|^\.\.\.$/.test(row[0].text.replace(/\*\*/g, "").trim())
  );

  if (isStepTable) return stepsTableToMarkdown(rows);
  return iconTableToMarkdown(rows);
}

/** Recursively extract text and images from a table cell */
function deepCellContent(td) {
  let text = "";
  let images = [];

  function walk(node) {
    if (node.type === "text") {
      text += $(node).text();
      return;
    }
    const tag = node.tagName;
    if (tag === "img") {
      const src = $(node).attr("src");
      if (src) images.push(src);
      return;
    }
    if (tag === "strong" || tag === "b") {
      const inner = $(node).text();
      if (inner.trim()) text += `**${inner}**`;
      return;
    }
    if (tag === "em" || tag === "i") {
      const inner = $(node).text();
      if (inner.trim()) text += `*${inner}*`;
      return;
    }
    if (tag === "a") {
      const href = $(node).attr("href") || "";
      const linkText = $(node).text().trim();
      if (href && !href.startsWith("#")) {
        text += `[${linkText}](${href})`;
      } else {
        text += linkText;
      }
      return;
    }
    if (tag === "br") {
      text += "  \n";
      return;
    }
    if (tag === "p") {
      if (text && !text.endsWith("\n")) text += "  \n";
    }
    // Recurse into children
    $(node)
      .contents()
      .each((i, child) => walk(child));
    if (tag === "p") {
      if (!text.endsWith("\n")) text += "  \n";
    }
  }

  $(td)
    .contents()
    .each((i, child) => walk(child));

  return { text: text.trim(), images };
}

function stepsTableToMarkdown(rows) {
  let md = "";
  for (const row of rows) {
    const numRaw = row[0].text.replace(/\*\*/g, "").trim();
    if (numRaw === "…" || numRaw === "...") continue;

    const stepNum = numRaw;
    const descCell = row[1] || { text: "", images: [] };
    const imgCell = row.length > 2 ? row[2] : { text: "", images: [] };

    const allImages = [...descCell.images, ...imgCell.images];
    const description = descCell.text.replace(/  \n$/, "");

    md += `**${stepNum}.** ${description}\n\n`;

    for (const img of allImages) {
      md += `![](${img})\n\n`;
    }
  }
  return md;
}

function iconTableToMarkdown(rows) {
  let md = "| Ikon | Beskrivelse |\n";
  md += "|------|-------------|\n";
  for (const row of rows) {
    const iconCell = row[0] || { text: "", images: [] };
    const descCell = row[1] || { text: "", images: [] };
    const icon =
      iconCell.images.length > 0
        ? `![](${iconCell.images[0]})`
        : iconCell.text;
    const desc = descCell.text.replace(/\n/g, " ").replace(/  /g, " ");
    md += `| ${icon} | ${desc} |\n`;
  }
  return md;
}

function listToMarkdown(el, tag) {
  let md = "";
  $(el)
    .children("li")
    .each((i, li) => {
      const prefix = tag === "ol" ? `${i + 1}. ` : "- ";
      md += prefix + inlineContent(li).trim() + "\n";
    });
  return md;
}

// =============================================
// STEP 3: Map sections to doc files
// =============================================

function findSection(title) {
  return sections.find(
    (s) => s.title.trim().toLowerCase() === title.trim().toLowerCase()
  );
}

function findChild(parent, title) {
  if (!parent || !parent.children) return null;
  return parent.children.find(
    (c) => c.title.trim().toLowerCase() === title.trim().toLowerCase()
  );
}

function generatePageContent(title, position, section) {
  let md = `---\nsidebar_position: ${position}\n---\n\n# ${title}\n\n`;

  if (section) {
    if (section.content && section.content.length > 0) {
      md += htmlToMarkdown(section.content) + "\n\n";
    }
    if (section.children && section.children.length > 0) {
      for (const child of section.children) {
        md += `## ${child.title}\n\n`;
        if (child.content && child.content.length > 0) {
          md += htmlToMarkdown(child.content) + "\n\n";
        }
      }
    }
  }

  return md;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  Created dir: ${dir}`);
  }
}

function writeCategoryJson(folder, label, position, description) {
  const catPath = path.join(docsDir, folder, "_category_.json");
  if (fs.existsSync(catPath)) {
    console.log(`  Category already exists: ${catPath}`);
    return;
  }
  const cat = {
    label,
    position,
    link: {
      type: "generated-index",
      description: description || " ",
    },
  };
  fs.writeFileSync(catPath, JSON.stringify(cat, null, 2), "utf8");
  console.log(`  Created category: ${catPath}`);
}

// Pages that already have real content — DO NOT overwrite
const pagesWithContent = new Set([
  path.join(docsDir, "Intro", "Formål med løsnignen.md"),
  path.join(docsDir, "Intro", "Hvem kan oprette Leverandøradministratorer i løsningen.md"),
  path.join(docsDir, "Intro", "Ikoner i løsningen.md"),
  path.join(docsDir, "Log ind", "første_login.md"),
  path.join(docsDir, "Log ind", "andet_login.md"),
  path.join(docsDir, "Min virksomhed", "Virksomhedsdetaljer.md"),
]);

const sectionMapping = [
  {
    h1Title: "Kom godt i gang",
    skip: true,
  },
  {
    h1Title: "Tilgå løsningen",
    folder: "Log ind",
    asPage: { filename: "Tilgå løsningen.md", position: 0 },
  },
  {
    h1Title: "Log ind og log ud",
    folder: "Log ind",
    children: [
      { title: "Log ud", filename: "Log ud.md", position: 3, isNew: true },
    ],
  },
  {
    h1Title: "Min virksomhed – Overblik",
    folder: "Min virksomhed",
    children: [
      {
        title: "Min virksomhed – Projekter",
        filename: "Projektoverblik.md",
        position: 2,
      },
      {
        title: "Min virksomhed – Medarbejdere",
        filename: "Medarbejderoverblik.md",
        position: 3,
        includeChildren: true,
      },
      {
        title: "Min virksomhed – Dokumenter",
        filename: "Dokumementoverblik.md",
        position: 4,
      },
    ],
  },
  {
    h1Title: "Leverandører",
    folder: "Leverandører",
    children: [
      {
        title: "Opret dansk leverandør til leverandørliste",
        filename: "Opret dansk leverandør.md",
        position: 1,
      },
      {
        title: "Opret udenlandsk leverandør til leverandørliste",
        filename: "Opret udenlandsk leverandør.md",
        position: 2,
      },
    ],
  },
  {
    h1Title: "Projektoversigt – hvad kan jeg her?",
    folder: "Projektoversigt",
    children: [
      {
        title: "Se projektdetaljer og leverandørkæder",
        filename: "Projektoverblik.md",
        position: 1,
      },
      {
        title: "Vis medarbejdere på et projekt",
        filename: "Medarbejderoverblik.md",
        position: 2,
      },
      {
        title: "Tilføj underleverandør (dansk eller udenlandsk)",
        filename: "Virksomhedsdetaljer.md",
        position: 4,
      },
      {
        title: "Rediger oplysninger om underleverandør på projekt",
        filename: "Rediger leverandøropgave.md",
        position: 5,
      },
      {
        title: "Ændre placering i leverandørhierarki",
        filename: "Rediger leverandørhierarki.md",
        position: 6,
      },
      {
        title: "Fjern leverandør uden underleverandør(er)",
        filename: "Fjern leverandør.md",
        position: 7,
      },
    ],
  },
  {
    h1Title: "Medarbejdere",
    folder: "Medarbejdere",
    isNewCategory: true,
    categoryPosition: 6,
    categoryDescription:
      "Her finder du vejledninger til hvordan du administrerer medarbejdere i KMD Supplier Overview.",
    children: [
      {
        title: "Opret ny medarbejder til leverandør",
        filename: "Opret ny medarbejder.md",
        position: 1,
        isNew: true,
      },
      {
        title: "Tildel rollen som administrator til eksisterende medarbejder",
        filename: "Tildel administratorrolle.md",
        position: 2,
        isNew: true,
      },
      {
        title: "Opret administrator på en underleverandør (ny medarbejder)",
        filename: "Opret administrator på underleverandør.md",
        position: 3,
        isNew: true,
      },
      {
        title:
          "Tilføj en eller flere eksisterende medarbejder(e) til projekt via Projektliste",
        filename: "Tilføj medarbejder via Projektliste.md",
        position: 4,
        isNew: true,
      },
      {
        title:
          "Tilføj en eller flere eksisterende medarbejder(e) til projekt via Leverandørliste",
        filename: "Tilføj medarbejder via Leverandørliste.md",
        position: 5,
        isNew: true,
      },
      {
        title: "Rediger oplysninger på medarbejder",
        filename: "Rediger medarbejder.md",
        position: 6,
        isNew: true,
      },
      {
        title: "Fjern én eller flere medarbejder(e) fra projekt",
        filename: "Fjern medarbejder fra projekt.md",
        position: 7,
        isNew: true,
      },
      {
        title: "Fjern én eller flere medarbejder(e) fra leverandør",
        filename: "Fjern medarbejder fra leverandør.md",
        position: 8,
        isNew: true,
      },
      {
        title: "Filtrer i medarbejderlisten på et projekt",
        filename: "Filtrer medarbejderliste.md",
        position: 9,
        isNew: true,
      },
    ],
  },
  {
    h1Title: "ID-kort",
    folder: "ID-kort",
    isNewCategory: true,
    categoryPosition: 7,
    categoryDescription:
      "Her finder du vejledning om ID-kort i KMD Supplier Overview.",
    asStandalonePage: true,
  },
  {
    h1Title: "Notifikationer",
    folder: "Notifikationer",
    isNewCategory: true,
    categoryPosition: 8,
    categoryDescription:
      "Her finder du vejledning om notifikationer i KMD Supplier Overview.",
    asStandalonePage: true,
  },
];

// =============================================
// STEP 4: Generate the files
// =============================================

let stats = { created: 0, updated: 0, skipped: 0, protected: 0 };

for (const mapping of sectionMapping) {
  const h1Section = findSection(mapping.h1Title);

  if (!h1Section) {
    console.log(`\nWARNING: Section "${mapping.h1Title}" not found in docx`);
    console.log(
      `  Available: ${sections.map((s) => `"${s.title}"`).join(", ")}`
    );
    continue;
  }

  console.log(`\n=== Processing: ${mapping.h1Title} ===`);

  if (mapping.skip) {
    console.log("  Skipped (already has hand-crafted content)");
    stats.skipped++;
    continue;
  }

  const folderPath = path.join(docsDir, mapping.folder);
  ensureDir(folderPath);

  if (mapping.isNewCategory) {
    writeCategoryJson(
      mapping.folder,
      mapping.folder,
      mapping.categoryPosition,
      mapping.categoryDescription
    );
  }

  // Standalone page from h1 (e.g. "Tilgå løsningen")
  if (mapping.asPage) {
    const pagePath = path.join(folderPath, mapping.asPage.filename);
    if (pagesWithContent.has(pagePath)) {
      console.log(`  Protected: ${mapping.asPage.filename}`);
      stats.protected++;
    } else {
      const content = generatePageContent(
        h1Section.title,
        mapping.asPage.position,
        h1Section
      );
      fs.writeFileSync(pagePath, content, "utf8");
      console.log(`  Created: ${mapping.asPage.filename}`);
      stats.created++;
    }
  }

  // Standalone page for sections like ID-kort, Notifikationer
  if (mapping.asStandalonePage) {
    const filename = `${mapping.folder}.md`;
    const pagePath = path.join(folderPath, filename);

    let md = `---\nsidebar_position: 1\n---\n\n# ${h1Section.title}\n\n`;
    if (h1Section.content.length > 0) {
      md += htmlToMarkdown(h1Section.content) + "\n\n";
    }
    for (const child of h1Section.children) {
      md += `## ${child.title}\n\n`;
      if (child.content && child.content.length > 0) {
        md += htmlToMarkdown(child.content) + "\n\n";
      }
      if (child.children) {
        for (const gc of child.children) {
          md += `### ${gc.title}\n\n`;
          if (gc.content && gc.content.length > 0) {
            md += htmlToMarkdown(gc.content) + "\n\n";
          }
        }
      }
    }

    fs.writeFileSync(pagePath, md, "utf8");
    console.log(`  Created: ${filename}`);
    stats.created++;
    continue;
  }

  // Map h2 children to individual pages
  if (mapping.children) {
    for (const childMapping of mapping.children) {
      const h2Section = findChild(h1Section, childMapping.title);

      if (!h2Section) {
        console.log(
          `  WARNING: Subsection "${childMapping.title}" not found under "${mapping.h1Title}"`
        );
        continue;
      }

      const pagePath = path.join(folderPath, childMapping.filename);

      if (pagesWithContent.has(pagePath)) {
        console.log(`  Protected: ${childMapping.filename}`);
        stats.protected++;
        continue;
      }

      const content = generatePageContent(
        childMapping.title,
        childMapping.position,
        h2Section
      );

      fs.writeFileSync(pagePath, content, "utf8");

      if (childMapping.isNew) {
        console.log(`  Created: ${childMapping.filename}`);
        stats.created++;
      } else {
        console.log(`  Updated (was stub): ${childMapping.filename}`);
        stats.updated++;
      }
    }
  }
}

console.log("\n========== Summary ==========");
console.log(`Created (new): ${stats.created}`);
console.log(`Updated (stubs): ${stats.updated}`);
console.log(`Skipped (whole section): ${stats.skipped}`);
console.log(`Protected (has content): ${stats.protected}`);
console.log(`Total h1 sections in docx: ${sections.length}`);
