let cache = {
  data: null,
  updatedAt: null
};

export function getNewReleasesCache() {
  return cache.data;
}

export function setNewReleasesCache(data) {
  cache.data = data;
  cache.updatedAt = new Date();
}

export function clearNewReleasesCache() {
  cache.data = null;
  cache.updatedAt = null;
}
