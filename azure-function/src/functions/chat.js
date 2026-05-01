import { app } from '@azure/functions';
import { AzureKeyCredential } from '@azure/core-auth';
import { SearchClient } from '@azure/search-documents';
import OpenAI from 'openai';

const EMBED_MODEL = process.env.AZURE_OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const CHAT_MODEL = process.env.AZURE_OPENAI_CHAT_MODEL || 'gpt-4o';
const INDEX_NAME = process.env.AZURE_SEARCH_INDEX || 'supplier-docs';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://sxgkmd.github.io';
const TOP_K = 5;

const openai = new OpenAI({
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai`,
  apiKey: process.env.AZURE_OPENAI_KEY,
  defaultQuery: { 'api-version': '2024-02-01' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_KEY },
});

const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  INDEX_NAME,
  new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM_PROMPT = `Du er en hjælpsom AI-assistent for KMD Supplier Overview – et system til håndtering af leverandører, medarbejdere og ID-kort i bygge- og anlægsprojekter.

Du svarer KUN på spørgsmål baseret på den dokumentation, du har fået som kontekst. Svar altid på dansk.

Regler:
- Svar præcist og kortfattet baseret på konteksten
- Hvis svaret ikke fremgår af konteksten, sig: "Jeg kan desværre ikke finde den information i dokumentationen."
- Referer til relevante afsnit når det giver mening
- Brug nummererede trin ved procedurer
- Undgå at gætte eller opfinde information`;

async function embedText(text) {
  const response = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

async function searchDocs(questionEmbedding, question) {
  const results = await searchClient.search(question, {
    vectorSearchOptions: {
      queries: [
        {
          kind: 'vector',
          vector: questionEmbedding,
          kNearestNeighborsCount: TOP_K,
          fields: ['embedding'],
        },
      ],
    },
    queryType: 'semantic',
    semanticSearchOptions: {
      configurationName: 'default-semantic',
    },
    select: ['title', 'content', 'url', 'section'],
    top: TOP_K,
  });

  const docs = [];
  for await (const result of results.results) {
    docs.push(result.document);
  }
  return docs;
}

function buildContext(docs) {
  return docs
    .map((doc, i) => `[Kilde ${i + 1}: ${doc.title}]\n${doc.content}`)
    .join('\n\n---\n\n');
}

app.http('chat', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return { status: 204, headers: CORS_HEADERS };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Ugyldig JSON i request body' }),
      };
    }

    const question = (body?.question || '').trim();
    if (!question) {
      return {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Manglende felt: question' }),
      };
    }

    try {
      context.log(`Chat request: "${question}"`);

      const embedding = await embedText(question);
      const docs = await searchDocs(embedding, question);

      if (docs.length === 0) {
        return {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answer: 'Jeg kan desværre ikke finde relevant information i dokumentationen om dette emne.',
            sources: [],
          }),
        };
      }

      const contextText = buildContext(docs);
      const completion = await openai.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Kontekst fra dokumentationen:\n\n${contextText}\n\n---\n\nSpørgsmål: ${question}`,
          },
        ],
        max_tokens: 800,
        temperature: 0.2,
      });

      const answer = completion.choices[0]?.message?.content || 'Ingen svar modtaget.';
      const sources = docs
        .filter((d, i, arr) => arr.findIndex((x) => x.url === d.url) === i)
        .map((d) => ({ title: d.title, url: d.url }));

      return {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer, sources }),
      };
    } catch (err) {
      context.error('Chat error:', err);
      return {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Intern serverfejl. Prøv igen.' }),
      };
    }
  },
});
