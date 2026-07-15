/**
 * Rate limiter for Contentful Management API calls
 * CMA has limits: 20 requests/second maximum
 */

interface RateLimiterOptions {
  maxRequestsPerSecond?: number;
  maxConcurrent?: number;
}

export class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private running = 0;
  private lastRequestTime = 0;
  private minDelayMs: number;
  private maxConcurrent: number;

  constructor(options: RateLimiterOptions = {}) {
    // Default: 18 requests/second (conservative, CMA limit is 20/sec)
    const requestsPerSecond = options.maxRequestsPerSecond || 18;
    this.minDelayMs = 1000 / requestsPerSecond;
    // Increase concurrency to take advantage of higher rate limit
    this.maxConcurrent = options.maxConcurrent || 10; // Max 10 concurrent requests
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  /**
   * Process the queue with rate limiting
   */
  private async processQueue(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const task = this.queue.shift()!;

    try {
      // Ensure minimum delay between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.minDelayMs) {
        await this.delay(this.minDelayMs - timeSinceLastRequest);
      }

      this.lastRequestTime = Date.now();
      await task();
    } finally {
      this.running--;
      // Process next item in queue
      this.processQueue();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for all queued tasks to complete
   */
  async waitForCompletion(): Promise<void> {
    while (this.queue.length > 0 || this.running > 0) {
      await this.delay(50);
    }
  }
}

/**
 * Retry logic with exponential backoff for rate limit errors (429)
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, error: any) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 5,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    onRetry,
  } = options;

  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a rate limit error (429)
      const isRateLimit = error.status === 429 || 
                         error.response?.status === 429 ||
                         error.message?.includes('429') ||
                         error.message?.toLowerCase().includes('rate limit') ||
                         error.message?.toLowerCase().includes('too many requests');

      if (!isRateLimit || attempt === maxRetries) {
        // Not a rate limit error, or max retries reached
        throw error;
      }

      // Calculate exponential backoff delay
      const delayMs = Math.min(
        initialDelayMs * Math.pow(2, attempt),
        maxDelayMs
      );

      // Check if error response includes Retry-After header
      const retryAfter = error.response?.headers?.['retry-after'] ||
                        error.response?.headers?.['Retry-After'];
      
      const finalDelay = retryAfter ? parseInt(retryAfter) * 1000 : delayMs;

      if (onRetry) {
        onRetry(attempt + 1, error);
      }

      
      await new Promise(resolve => setTimeout(resolve, finalDelay));
    }
  }

  throw lastError;
}

/**
 * Process items in batches with concurrency control
 * Improved version that properly manages concurrency
 */
export async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: {
    batchSize?: number;
    concurrency?: number;
    onProgress?: (processed: number, total: number) => void;
  } = {}
): Promise<R[]> {
  const {
    batchSize = 50, // Larger batches for better throughput
    concurrency = 10, // Higher concurrency to match rate limiter
    onProgress,
  } = options;

  const results: R[] = [];
  let processed = 0;

  // Process items with concurrency control using the simpler parallel function
  return processInParallel(items, processor, { concurrency, onProgress });
}

/**
 * Process items in parallel with concurrency limit (simpler version)
 */
export async function processInParallel<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: {
    concurrency?: number;
    onProgress?: (processed: number, total: number) => void;
  } = {}
): Promise<R[]> {
  const {
    concurrency = 10,
    onProgress,
  } = options;

  const results: R[] = [];
  let processed = 0;
  let index = 0;

  // Process items with concurrency control
  const workers: Promise<void>[] = [];

  const processNext = async (): Promise<void> => {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      
      try {
        const result = await processor(item);
        results[currentIndex] = result;
        processed++;
        if (onProgress) {
          onProgress(processed, items.length);
        }
      } catch (error) {
        processed++;
        if (onProgress) {
          onProgress(processed, items.length);
        }
        throw error;
      }
    }
  };

  // Start workers
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(processNext());
  }

  await Promise.all(workers);

  return results;
}

