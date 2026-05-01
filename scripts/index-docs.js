#!/usr/bin/env node
/**
 * Indexes all markdown documentation files into Azure AI Search with vector embeddings.
 *
 * Prerequisites:
 *   npm install @azure/openai @azure/search-documents dotenv glob
 *
 * Environment variables (set in .env or shell):
 *   AZURE_OPENAI_ENDPOINT     - e.g. https://my-resource.openai.azure.com
 *   AZURE_OPENAI_KEY          - API key
 *   AZURE_OPENAI_EMBED_MODEL  - deployment name, e.g. text-embedding-3-small
 *   AZURE_SEARCH_ENDPOINT     - e.g. https://my-search.search.windows.net
 *   AZURE_SEARCH_KEY          - Admin API key
 *   AZURE_SEARCH_INDEX        - Index name, e.g. supplier-docs
 *
 * Usage:
 *   node scripts/index-docs.js
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AzureKeyCredential } from '@azure/core-auth';
import { AzureOpenAI } from 'openai';
import { SearchIndexClient, SearchClient } from '@azure/search-documents';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const BASE_URL = '/SupplierOverviewDocumentation/docs';

const EMBED_MODEL = process.env.AZURE_OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const INDEX_NAME = process.env.AZURE_SEARCH_INDEX || 'supplier-docs';
const VECTOR_DIM = 1536;
const BATCH_SIZE = 10;

const openai = new AzureOpenAI({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiKey: process.env.AZURE_OPENAI_KEY,
  apiVersion: '2024-02-01',
});

const searchIndexClient = new SearchIndexClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
);

const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  INDEX_NAME,
  new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
);

async function ensureIndex() {
  console.log(`Ensuring index "${INDEX_NAME}" exists...`);
  try {
    await searchIndexClient.getIndex(INDEX_NAME);
    console.log('Index already exists.');
  } catch {
    console.log('Creating index...');
    await searchIndexClient.createIndex({
      name: INDEX_NAME,
      fields: [
        { name: 'id', type: 'Edm.String', key: true, filterable: true },
        { name: 'title', type: 'Edm.String', searchable: true, retrievable: true },
        { name: 'content', type: 'Edm.String', searchable: true, retrievable: true },
        { name: 'url', type: 'Edm.String', retrievable: true },
        { name: 'section', type: 'Edm.String', filterable: true, retrievable: true },
        {
          name: 'embedding',
          type: 'Collection(Edm.Single)',
          retrievable: false,
          searchable: true,
          vectorSearchDimensions: VECTOR_DIM,
          vectorSearchProfileName: 'default-profile',
        },
      ],
      vectorSearch: {
        algorithms: [{ name: 'hnsw-algo', kind: 'hnsw' }],
        profiles: [{ name: 'default-profile', algorithmConfigurationName: 'hnsw-algo' }],
      },
      semanticSearch: {
        defaultConfigurationName: 'default-semantic',
        configurations: [
          {
            name: 'default-semantic',
            prioritizedFields: {
              titleField: { fieldName: 'title' },
              contentFields: [{ fieldName: 'content' }],
            },
          },
        ],
      },
    });
    console.log('Index created.');
  }
}

function getAllMarkdownFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

function filePathToUrl(filePath) {
  const rel = path.relative(DOCS_DIR, filePath).replace(/\\/g, '/').replace(/\.md$/, '');
  return `${BASE_URL}/${rel}`;
}

function filePathToSection(filePath) {
  const rel = path.relative(DOCS_DIR, filePath).replace(/\\/g, '/');
  return rel.split('/')[0] || 'root';
}

function sanitizeId(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100);
}

function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function chunkByHeadings(content, maxChars = 3000) {
  const lines = content.split('\n');
  const chunks = [];
  let currentTitle = '';
  let currentLines = [];

  const flush = () => {
    const text = currentLines.join('\n').trim();
    if (text.length > 30) {
      chunks.push({ title: currentTitle, content: text });
    }
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);

    if (h2 || h3) {
      if (currentLines.length > 0 && currentLines.join('\n').trim().length > 30) {
        // If current chunk is too large, split further
        const text = currentLines.join('\n');
        if (text.length > maxChars) {
          for (let i = 0; i < text.length; i += maxChars) {
            chunks.push({ title: currentTitle, content: text.slice(i, i + maxChars).trim() });
          }
        } else {
          flush();
        }
      }
      currentTitle = (h2 || h3)[1].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return chunks;
}

async function embedTexts(texts) {
  const response = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

async function indexFile(filePath, fileIndex) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const url = filePathToUrl(filePath);
  const section = filePathToSection(filePath);
  const fileTitle = extractTitle(content) || path.basename(filePath, '.md');
  const chunks = chunkByHeadings(content);

  if (chunks.length === 0) return [];

  const docs = chunks.map((chunk, i) => ({
    id: sanitizeId(`${fileIndex}-${path.basename(filePath, '.md')}-${i}`),
    title: chunk.title || fileTitle,
    content: chunk.content,
    url,
    section,
    _text: `${chunk.title || fileTitle}\n${chunk.content}`,
  }));

  return docs;
}

async function run() {
  await ensureIndex();

  const files = getAllMarkdownFiles(DOCS_DIR);
  console.log(`Found ${files.length} markdown files.`);

  const allDocs = [];
  for (let i = 0; i < files.length; i++) {
    const docs = await indexFile(files[i], i);
    allDocs.push(...docs);
    if (i % 10 === 0) console.log(`  Processed ${i + 1}/${files.length} files...`);
  }

  console.log(`Total chunks to embed: ${allDocs.length}`);

  for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
    const batch = allDocs.slice(i, i + BATCH_SIZE);
    console.log(`  Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allDocs.length / BATCH_SIZE)}...`);

    const embeddings = await embedTexts(batch.map((d) => d._text));

    const uploadBatch = batch.map((doc, j) => ({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      url: doc.url,
      section: doc.section,
      embedding: embeddings[j],
    }));

    await searchClient.uploadDocuments(uploadBatch);
  }

  console.log(`Done. ${allDocs.length} chunks indexed into "${INDEX_NAME}".`);
}

run().catch((err) => {
  console.error('Indexing failed:', err);
  process.exit(1);
});
