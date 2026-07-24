import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { s3Api, type Bucket, type S3Object, type S3Folder } from '@/api';
import {
  Folder,
  File,
  FileImage,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileVideo,
  FileAudio,
  FileText,
  Upload,
  Download,
  Trash2,
  Home,
  Loader2,
  Search,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/toast';

type SortKey = 'name' | 'date' | 'size';
type SortDir = 'asc' | 'desc';

const FILE_ICONS: Record<string, typeof File> = {
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage, webp: FileImage,
  zip: FileArchive, tar: FileArchive, gz: FileArchive, rar: FileArchive, '7z': FileArchive,
  js: FileCode, ts: FileCode, tsx: FileCode, jsx: FileCode, py: FileCode, json: FileCode, html: FileCode, css: FileCode,
  csv: FileSpreadsheet, xls: FileSpreadsheet, xlsx: FileSpreadsheet,
  mp4: FileVideo, mov: FileVideo, avi: FileVideo, webm: FileVideo,
  mp3: FileAudio, wav: FileAudio, ogg: FileAudio,
  txt: FileText, md: FileText, pdf: FileText, doc: FileText, docx: FileText,
};

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return FILE_ICONS[ext] ?? File;
}

export function FileExplorer() {
  const [activeBucketId, setActiveBucketId] = useState<string>('');
  const [currentPrefix, setCurrentPrefix] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: buckets, isLoading: isLoadingBuckets } = useQuery({
    queryKey: ['buckets'],
    queryFn: s3Api.getBuckets,
  });

  useEffect(() => {
    if (buckets?.length && !activeBucketId) {
      setActiveBucketId(buckets[0].id);
    }
  }, [buckets, activeBucketId]);

  const activeBucket = buckets?.find(b => b.id === activeBucketId);

  const { data: listData, isLoading: isLoadingObjects, isError: isListError, error: listError } = useQuery({
    queryKey: ['objects', activeBucketId, currentPrefix],
    queryFn: () => s3Api.listObjects(activeBucketId, currentPrefix),
    enabled: !!activeBucketId,
  });

  useEffect(() => {
    if (isListError) {
      const detail = axios.isAxiosError(listError) ? listError.response?.data?.detail : undefined;
      toast.add({ title: 'Could not load folder', description: detail ?? 'Check the bucket configuration and try again.', type: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListError, activeBucketId, currentPrefix]);

  const deleteMutation = useMutation({
    mutationFn: (key: string) => s3Api.deleteObject(activeBucketId, key),
    onSuccess: (_data, key) => {
      queryClient.invalidateQueries({ queryKey: ['objects', activeBucketId, currentPrefix] });
      toast.add({ title: 'Deleted', description: key.split('/').pop(), type: 'success' });
    },
    onError: () => {
      toast.add({ title: 'Delete failed', description: 'The object could not be deleted.', type: 'error' });
    },
  });

  const handleNavigate = (prefix: string) => {
    setCurrentPrefix(prefix);
    setSearch('');
  };

  const handleNavigateUp = () => {
    const parts = currentPrefix.split('/').filter(Boolean);
    parts.pop();
    handleNavigate(parts.length > 0 ? parts.join('/') + '/' : '');
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleDownload = async (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { url } = await s3Api.getDownloadUrl(activeBucketId, key);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Failed to download:', error);
      toast.add({ title: 'Download failed', description: 'Could not generate a download link.', type: 'error' });
    }
  };

  const requestDelete = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteKey(key);
  };

  const confirmDelete = () => {
    if (pendingDeleteKey) deleteMutation.mutate(pendingDeleteKey);
    setPendingDeleteKey(null);
  };

  const uploadFile = async (file: File) => {
    if (!activeBucketId) return;
    try {
      setIsUploading(true);
      const key = currentPrefix + file.name;
      const { url, fields } = await s3Api.getUploadUrl(activeBucketId, key);

      if (fields) {
        // Presigned POST
        const formData = new FormData();
        Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
        formData.append('file', file);
        await axios.post(url, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      } else {
        // Presigned PUT
        await axios.put(url, file, {
          headers: { 'Content-Type': file.type }
        });
      }

      queryClient.invalidateQueries({ queryKey: ['objects', activeBucketId, currentPrefix] });
      toast.add({ title: 'Upload complete', description: file.name, type: 'success' });
    } catch (error) {
      console.error('Upload failed:', error);
      toast.add({ title: 'Upload failed', description: file.name, type: 'error' });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && activeBucketId) uploadFile(file);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedFolders = useMemo(() => {
    const folders = listData?.folders ?? [];
    const filtered = search
      ? folders.filter((f: S3Folder) => f.prefix.slice(currentPrefix.length, -1).toLowerCase().includes(search.toLowerCase()))
      : folders;
    return [...filtered].sort((a, b) => a.prefix.localeCompare(b.prefix));
  }, [listData?.folders, search, currentPrefix]);

  const sortedObjects = useMemo(() => {
    const objects = listData?.objects ?? [];
    const filtered = search
      ? objects.filter((o: S3Object) => o.key.slice(currentPrefix.length).toLowerCase().includes(search.toLowerCase()))
      : objects;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'size') return (a.size - b.size) * dir;
      if (sortKey === 'date') return (new Date(a.last_modified).getTime() - new Date(b.last_modified).getTime()) * dir;
      return a.key.localeCompare(b.key) * dir;
    });
  }, [listData?.objects, search, currentPrefix, sortKey, sortDir]);

  if (isLoadingBuckets) {
    return <div className="flex justify-center p-12"><Loader2 className="animate-spin w-8 h-8 text-blue-400" /></div>;
  }

  if (!buckets?.length) {
    return (
      <Card className="m-8">
        <CardContent className="p-8 text-center text-slate-500">
          No buckets configured. Add <code>BUCKET_1_ID</code>, <code>BUCKET_1_NAME</code>, etc. to your <code>.env</code> file.
        </CardContent>
      </Card>
    );
  }

  const breadcrumbs = currentPrefix.split('/').filter(Boolean);

  const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) => (
    <button
      type="button"
      onClick={() => toggleSort(sortKeyName)}
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      {sortKey === sortKeyName && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
    </button>
  );

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4 md:p-8">
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
        <div className="relative w-full sm:w-[250px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this folder..."
            className="pl-8"
          />
        </div>
        <div className="w-full sm:w-[250px]">
          <Select value={activeBucketId} onValueChange={(val) => { setActiveBucketId(val || ''); handleNavigate(''); }}>
            <SelectTrigger>
              <SelectValue placeholder="Select bucket..." />
            </SelectTrigger>
            <SelectContent>
              {buckets.map((b: Bucket) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.bucket_name} ({b.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="glass shadow-sm border-0 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md">
        <CardHeader className="flex flex-row items-center justify-between pb-4 space-y-0 border-b">
          <CardTitle>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink
                    onClick={(e: React.MouseEvent) => { e.preventDefault(); handleNavigate(''); }}
                    href="#"
                    className="flex items-center gap-2"
                  >
                    <Home className="w-4 h-4" />
                    <span>{activeBucket?.bucket_name || activeBucketId}</span>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {breadcrumbs.length > 0 && <BreadcrumbSeparator />}

                {breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1;
                  const prefix = breadcrumbs.slice(0, idx + 1).join('/') + '/';
                  return (
                    <span key={prefix} className="flex items-center gap-1.5 sm:gap-2.5">
                      <BreadcrumbItem>
                        {isLast ? (
                          <BreadcrumbPage>{crumb}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink
                            onClick={(e: React.MouseEvent) => { e.preventDefault(); handleNavigate(prefix); }}
                            href="#"
                          >
                            {crumb}
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                      {!isLast && <BreadcrumbSeparator />}
                    </span>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </CardTitle>
          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || !activeBucketId}
            >
              {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              <span className="hidden sm:inline">{isUploading ? 'Uploading...' : 'Upload File'}</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div
            className={`border-0 transition-colors ${isDragOver ? 'bg-blue-500/10 ring-2 ring-inset ring-blue-500/40' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <Table>
              <TableHeader className="bg-slate-50/50 dark:bg-slate-800/50">
                <TableRow>
                  <TableHead className="w-[50%]"><SortHeader label="Name" sortKeyName="name" /></TableHead>
                  <TableHead className="hidden sm:table-cell"><SortHeader label="Last Modified" sortKeyName="date" /></TableHead>
                  <TableHead className="text-right"><SortHeader label="Size" sortKeyName="size" /></TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingObjects ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      <Loader2 className="animate-spin w-6 h-6 mx-auto text-slate-400" />
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {currentPrefix && (
                      <TableRow
                        onClick={handleNavigateUp}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <TableCell colSpan={4} className="flex items-center gap-2">
                          <Folder className="w-4 h-4 text-blue-500 fill-blue-500/20" />
                          <span className="font-medium text-slate-600 dark:text-slate-300">..</span>
                        </TableCell>
                      </TableRow>
                    )}

                    {sortedFolders.map((folder: S3Folder) => {
                      const folderName = folder.prefix.slice(currentPrefix.length, -1);
                      return (
                        <TableRow
                          key={folder.prefix}
                          onClick={() => handleNavigate(folder.prefix)}
                          className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          <TableCell className="font-medium flex items-center gap-2">
                            <Folder className="w-4 h-4 text-blue-500 fill-blue-500/20" />
                            {folderName}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-slate-500">-</TableCell>
                          <TableCell className="text-right text-slate-500">-</TableCell>
                          <TableCell className="text-right"></TableCell>
                        </TableRow>
                      );
                    })}

                    {sortedObjects.map((obj: S3Object) => {
                      const fileName = obj.key.slice(currentPrefix.length);
                      const Icon = getFileIcon(fileName);
                      return (
                        <TableRow key={obj.key} className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <TableCell className="font-medium flex items-center gap-2">
                            <Icon className="w-4 h-4 text-slate-400" />
                            <span className="truncate max-w-[150px] sm:max-w-[300px]">{fileName}</span>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-slate-500 truncate">
                            {new Date(obj.last_modified).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-slate-500 whitespace-nowrap">
                            {formatSize(obj.size)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e: React.MouseEvent) => handleDownload(obj.key, e)}
                                title="Download"
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                onClick={(e: React.MouseEvent) => requestDelete(obj.key, e)}
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {!sortedFolders.length && !sortedObjects.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="h-32 text-center text-slate-500">
                          <div className="flex flex-col items-center gap-2">
                            <File className="w-8 h-8 opacity-20" />
                            <p>{search ? 'No files match your search' : 'This folder is empty'}</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingDeleteKey} onOpenChange={(open) => !open && setPendingDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{pendingDeleteKey?.split('/').pop()}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
