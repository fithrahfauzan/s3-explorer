import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Lets the app react immediately when a session expires mid-use (any
// protected call starts 401ing) instead of waiting for the next manual
// auth-status refetch. Registered once near the app root.
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;
export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null) => {
  onUnauthorized = handler;
};

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  }
);

export interface Bucket {
  id: string;
  bucket_name: string;
  region: string;
}

export interface S3Object {
  key: string;
  size: number;
  last_modified: string;
}

export interface S3Folder {
  prefix: string;
}

export interface ListObjectsResponse {
  objects: S3Object[];
  folders: S3Folder[];
}

export interface PresignedUrl {
  url: string;
  fields?: Record<string, string>;
  content_type?: string;
}

export interface AppConfig {
  restricted_mode: boolean;
}

export interface AuthStatus {
  auth_enabled: boolean;
  authenticated: boolean;
}

export const authApi = {
  getStatus: async (): Promise<AuthStatus> => {
    const { data } = await api.get('/auth/status');
    return data;
  },

  login: async (password: string): Promise<void> => {
    await api.post('/auth/login', { password });
  },

  logout: async (): Promise<void> => {
    await api.post('/auth/logout');
  },
};

export const s3Api = {
  getConfig: async (): Promise<AppConfig> => {
    const { data } = await api.get('/config');
    return data;
  },

  getBuckets: async (): Promise<Bucket[]> => {
    const { data } = await api.get('/buckets');
    return data;
  },

  listObjects: async (bucketId: string, prefix: string = ''): Promise<ListObjectsResponse> => {
    const { data } = await api.get(`/buckets/${bucketId}/objects`, {
      params: { prefix },
    });
    return data;
  },

  getUploadUrl: async (
    bucketId: string,
    key: string,
    manual: boolean = false,
    contentType?: string,
  ): Promise<PresignedUrl> => {
    const { data } = await api.post(`/buckets/${bucketId}/upload-url`, {
      key,
      manual,
      content_type: contentType || undefined,
    });
    return data;
  },

  getDownloadUrl: async (bucketId: string, key: string): Promise<PresignedUrl> => {
    const { data } = await api.post(`/buckets/${bucketId}/download-url`, { key });
    return data;
  },
  
  deleteObject: async (bucketId: string, key: string): Promise<void> => {
    await api.delete(`/buckets/${bucketId}/objects`, {
      params: { key },
    });
  },
};
