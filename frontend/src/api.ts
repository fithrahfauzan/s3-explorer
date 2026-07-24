import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

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
}

export interface AppConfig {
  restricted_mode: boolean;
}

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

  getUploadUrl: async (bucketId: string, key: string): Promise<PresignedUrl> => {
    const { data } = await api.post(`/buckets/${bucketId}/upload-url`, { key });
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
