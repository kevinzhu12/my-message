/**
 * Shared photo cache for contact photos.
 *
 * This module provides a centralized cache for contact photos with:
 * - In-memory caching of photo URLs
 * - Negative caching (tracks contacts without photos to avoid re-fetching)
 * - Request deduplication (prevents duplicate fetches for the same handle)
 * - Concurrency limiting (max 3 parallel fetches)
 * - Queue-based processing for fair scheduling
 */

const API_BASE = "http://127.0.0.1:3883";

// Cache for successful photo URLs
const photoCache = new Map<string, string>();

// Cache for handles that have no photo (negative cache)
// Value is timestamp when the negative result was cached
const noPhotoCache = new Map<string, number>();

// TTL for negative cache entries (10 minutes)
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;

// In-flight requests to prevent duplicate fetches
const photoRequests = new Map<string, Promise<string | null>>();

// Queue for pending photo fetches
const photoFetchQueue: Array<() => void> = [];

// Track active fetches for concurrency control
let activePhotoFetches = 0;
const PHOTO_FETCH_CONCURRENCY = 3;

/**
 * Process the next item in the fetch queue if under concurrency limit
 */
function runNextPhotoFetch(): void {
  if (activePhotoFetches >= PHOTO_FETCH_CONCURRENCY) return;
  const task = photoFetchQueue.shift();
  if (!task) return;
  activePhotoFetches += 1;
  task();
}

/**
 * Check if a handle has a cached "no photo" result that's still valid
 */
function isNegativelyCached(handle: string): boolean {
  const cachedTime = noPhotoCache.get(handle);
  if (cachedTime === undefined) return false;

  const age = Date.now() - cachedTime;
  if (age > NEGATIVE_CACHE_TTL_MS) {
    // Expired, remove from cache
    noPhotoCache.delete(handle);
    return false;
  }
  return true;
}

/**
 * Get the cached photo URL for a handle, if available.
 * Returns the URL if cached, null if negatively cached (no photo), or undefined if not cached.
 */
export function getCachedPhoto(handle: string): string | null | undefined {
  // Check positive cache first
  const cached = photoCache.get(handle);
  if (cached) return cached;

  // Check negative cache
  if (isNegativelyCached(handle)) return null;

  // Not in any cache
  return undefined;
}

/**
 * Fetch a contact photo, using cache when available.
 * Returns the photo URL if successful, or null if no photo exists.
 *
 * This function:
 * - Returns immediately if the photo is cached
 * - Returns null immediately if negatively cached (no photo)
 * - Deduplicates concurrent requests for the same handle
 * - Queues requests to respect concurrency limits
 */
export function fetchContactPhoto(handle: string): Promise<string | null> {
  // Check positive cache
  const cached = photoCache.get(handle);
  if (cached) {
    return Promise.resolve(cached);
  }

  // Check negative cache
  if (isNegativelyCached(handle)) {
    return Promise.resolve(null);
  }

  // Check if already fetching
  const existingRequest = photoRequests.get(handle);
  if (existingRequest) {
    return existingRequest;
  }

  // Create new fetch request
  const request = new Promise<string | null>((resolve) => {
    const task = () => {
      const encodedHandle = encodeURIComponent(handle);
      const url = `${API_BASE}/contacts/${encodedHandle}/photo`;

      fetch(url)
        .then((res) => {
          if (res.ok) {
            // Cache the successful URL
            photoCache.set(handle, url);
            resolve(url);
          } else {
            // Cache the negative result
            noPhotoCache.set(handle, Date.now());
            resolve(null);
          }
        })
        .catch(() => {
          // On network error, don't cache (might be transient)
          resolve(null);
        })
        .finally(() => {
          activePhotoFetches = Math.max(0, activePhotoFetches - 1);
          photoRequests.delete(handle);
          runNextPhotoFetch();
        });
    };

    photoFetchQueue.push(task);
    runNextPhotoFetch();
  });

  photoRequests.set(handle, request);
  return request;
}

/**
 * Build the photo URL for a handle (without fetching).
 * Use this when you just need the URL format.
 */
export function getPhotoUrl(handle: string): string {
  const encodedHandle = encodeURIComponent(handle);
  return `${API_BASE}/contacts/${encodedHandle}/photo`;
}

/**
 * Clear all cached photos (both positive and negative caches).
 * Useful for testing or when contacts may have been updated.
 */
export function clearPhotoCache(): void {
  photoCache.clear();
  noPhotoCache.clear();
}

/**
 * Get cache statistics for debugging/monitoring.
 */
export function getPhotoCacheStats(): {
  cachedPhotos: number;
  negativelyCached: number;
  pendingRequests: number;
  queuedFetches: number;
  activeFetches: number;
} {
  return {
    cachedPhotos: photoCache.size,
    negativelyCached: noPhotoCache.size,
    pendingRequests: photoRequests.size,
    queuedFetches: photoFetchQueue.length,
    activeFetches: activePhotoFetches,
  };
}
