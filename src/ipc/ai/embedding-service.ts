/**
 * Embedding Service — local text embedding using Transformers.js
 *
 * Generates 384-dimensional vector embeddings entirely offline.
 * Uses Xenova/all-MiniLM-L6-v2 model (optimized for semantic similarity).
 * No data leaves the machine — 100% privacy.
 */

type FeatureExtractionOutput = {
  data: Float32Array;
};

type FeatureExtractionPipeline = (
  input: string | string[],
  options: { normalize: boolean; pooling: "mean" },
) => Promise<FeatureExtractionOutput>;

type PipelineFactory = (
  task: "feature-extraction",
  model: string,
  options: { quantized: boolean },
) => Promise<FeatureExtractionPipeline>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let embedder: FeatureExtractionPipeline | null = null;
let isLoading = false;
let loadPromise: Promise<FeatureExtractionPipeline> | null = null;
let pipelineFactory: PipelineFactory | null = null;

// ---------------------------------------------------------------------------
// Model Loading
// ---------------------------------------------------------------------------

/**
 * Load the embedding model (lazy initialization).
 * First call downloads ~90MB model to ~/.cache/transformers.
 */
async function loadModel(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder;
  if (loadPromise) return loadPromise;

  if (isLoading) {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (embedder) {
          resolve(embedder);
        } else if (!isLoading) {
          reject(new Error("Model loading failed"));
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  isLoading = true;
  loadPromise = (async () => {
    try {
      if (!pipelineFactory) {
        const transformersModule = await import("@xenova/transformers");
        pipelineFactory = transformersModule.pipeline as PipelineFactory;
      }

      const model = await pipelineFactory("feature-extraction", MODEL_NAME, {
        quantized: true, // Use quantized model for faster inference
      });
      embedder = model;
      isLoading = false;
      return model;
    } catch (err) {
      isLoading = false;
      loadPromise = null;
      throw err;
    }
  })();

  return loadPromise;
}

/**
 * Check if model is ready (loaded or loading).
 */
export function isEmbeddingModelReady(): boolean {
  return embedder !== null;
}

/**
 * Get loading status.
 */
export function getEmbeddingStatus(): "ready" | "loading" | "uninitialized" {
  if (embedder) return "ready";
  if (isLoading) return "loading";
  return "uninitialized";
}

// ---------------------------------------------------------------------------
// Embedding Generation
// ---------------------------------------------------------------------------

/**
 * Generate embedding for a single text.
 * Returns 384-dimensional Float32Array.
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const model = await loadModel();

  // Clean and truncate text
  const cleanedText = text.trim().slice(0, 512); // Model limit

  if (!cleanedText) {
    return new Float32Array(EMBEDDING_DIM).fill(0);
  }

  const output = await model(cleanedText, {
    pooling: "mean",
    normalize: true,
  });

  // Extract the embedding vector
  const embedding = output.data as Float32Array;

  // Verify dimensions
  if (embedding.length !== EMBEDDING_DIM) {
    console.warn(`[Embedding] Unexpected dimension: ${embedding.length}, expected ${EMBEDDING_DIM}`);
  }

  return embedding;
}

/**
 * Generate embeddings for multiple texts (batch processing).
 * More efficient than calling generateEmbedding multiple times.
 */
export async function generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
  const model = await loadModel();

  // Clean texts
  const cleanedTexts = texts.map((t) => t.trim().slice(0, 512));

  const outputs = await model(cleanedTexts, {
    pooling: "mean",
    normalize: true,
  });

  // Extract embeddings for each input
  const embeddings: Float32Array[] = [];
  // outputs is a single Tensor with batch dimension [batch_size, embedding_dim]
  const data = outputs.data as Float32Array;
  for (let i = 0; i < texts.length; i++) {
    const start = i * EMBEDDING_DIM;
    const embedding = data.slice(start, start + EMBEDDING_DIM);
    embeddings.push(embedding);
  }

  return embeddings;
}

// ---------------------------------------------------------------------------
// Similarity Utilities
// ---------------------------------------------------------------------------

/**
 * Calculate cosine similarity between two embeddings.
 * Returns value between -1 and 1 (1 = identical).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find most similar embeddings from a candidate set.
 */
export function findMostSimilar(
  query: Float32Array,
  candidates: Array<{ id: string; embedding: Float32Array }>,
  options?: { topK?: number; minThreshold?: number }
): Array<{ id: string; similarity: number }> {
  const topK = options?.topK ?? 5;
  const minThreshold = options?.minThreshold ?? 0.7;

  const similarities = candidates
    .map((c) => ({
      id: c.id,
      similarity: cosineSimilarity(query, c.embedding),
    }))
    .filter((r) => r.similarity >= minThreshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return similarities;
}

// ---------------------------------------------------------------------------
// Preprocessing Utilities
// ---------------------------------------------------------------------------

/**
 * Extract key terms from text for better semantic search.
 * Removes stop words and focuses on schema-related terms.
 */
export function extractKeyTerms(text: string): string {
  const stopWords = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "must", "can", "this",
    "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "his", "her", "its",
    "our", "their", "what", "which", "who", "when", "where", "why", "how",
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 20) // Limit to 20 key terms
    .join(" ");
}

/**
 * Create a search-optimized version of query text.
 * Enhances schema/table/column references for better retrieval.
 */
export function optimizeQueryForSearch(text: string, context?: {
  schema?: string;
  table?: string;
  columns?: string[];
}): string {
  let optimized = text;

  // Add context markers if available
  if (context?.schema) {
    optimized += ` schema:${context.schema}`;
  }
  if (context?.table) {
    optimized += ` table:${context.table}`;
  }
  if (context?.columns?.length) {
    optimized += ` columns:${context.columns.join(",")}`;
  }

  return extractKeyTerms(optimized);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Dispose of the model to free memory.
 * Call when shutting down or when memory is needed.
 */
export async function disposeEmbeddingModel(): Promise<void> {
  if (embedder) {
    // Transformers.js doesn't expose dispose officially in types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (embedder as unknown as { dispose?: () => Promise<void> }).dispose?.();
    embedder = null;
    loadPromise = null;
    isLoading = false;
  }
}
