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
  Loader2,
  Search,
  ArrowUp,
  ArrowDown,
  UploadCloud,
} from 'lucide-react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
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
    return <div className="flex justify-center p-12"><Loader2 className="animate-spin w-6 h-6 text-primary" /></div>;
  }

  if (!buckets?.length) {
    return (
      <div className="border border-border rounded-lg bg-card p-8 text-center text-sm text-muted-foreground font-mono">
        No buckets configured. Add <code className="text-foreground">BUCKET_1_ID</code>, <code className="text-foreground">BUCKET_1_NAME</code>, etc. to your <code className="text-foreground">.env</code> file.
      </div>
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
    <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto p-4 md:p-8">
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="relative w-full sm:w-[260px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this folder..."
            className="pl-8 font-mono text-xs"
          />
        </div>
        <div className="w-full sm:w-[260px]">
          <Select value={activeBucketId} onValueChange={(val) => { setActiveBucketId(val || ''); handleNavigate(''); }}>
            <SelectTrigger className="w-full font-mono text-xs">
              <SelectValue placeholder="Select bucket..." />
            </SelectTrigger>
            <SelectContent>
              {buckets.map((b: Bucket) => (
                <SelectItem key={b.id} value={b.id} className="font-mono text-xs">
                  {b.bucket_name} ({b.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 h-12 border-b border-border">
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap font-mono text-[13px] gap-1">
              <span className="text-muted-foreground/50 shrink-0">s3://</span>
              <BreadcrumbItem className="shrink-0">
                <BreadcrumbLink
                  onClick={(e: React.MouseEvent) => { e.preventDefault(); handleNavigate(''); }}
                  href="#"
                  className="text-primary font-medium hover:text-primary/80"
                >
                  {activeBucket?.bucket_name || activeBucketId}
                </BreadcrumbLink>
              </BreadcrumbItem>
              {breadcrumbs.length > 0 && (
                <BreadcrumbSeparator className="text-muted-foreground/50">/</BreadcrumbSeparator>
              )}

              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                const prefix = breadcrumbs.slice(0, idx + 1).join('/') + '/';
                return (
                  <span key={prefix} className="flex items-center gap-1 min-w-0">
                    <BreadcrumbItem className="min-w-0">
                      {isLast ? (
                        <BreadcrumbPage className="truncate">{crumb}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink
                          onClick={(e: React.MouseEvent) => { e.preventDefault(); handleNavigate(prefix); }}
                          href="#"
                          className="truncate"
                        >
                          {crumb}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                    {!isLast && <BreadcrumbSeparator className="text-muted-foreground/50">/</BreadcrumbSeparator>}
                  </span>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="shrink-0">
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
              {isUploading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
              <span className="hidden sm:inline">{isUploading ? 'Uploading...' : 'Upload'}</span>
            </Button>
          </div>
        </div>

        <div
          className="relative"
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[50%] pl-4"><SortHeader label="Name" sortKeyName="name" /></TableHead>
                <TableHead className="hidden sm:table-cell font-mono"><SortHeader label="Modified" sortKeyName="date" /></TableHead>
                <TableHead className="text-right font-mono"><SortHeader label="Size" sortKeyName="size" /></TableHead>
                <TableHead className="text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingObjects ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="h-24 text-center">
                    <Loader2 className="animate-spin w-5 h-5 mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {currentPrefix && (
                    <TableRow
                      onClick={handleNavigateUp}
                      className="cursor-pointer"
                    >
                      <TableCell colSpan={4} className="pl-4">
                        <span className="flex items-center gap-2">
                          <Folder className="w-4 h-4 text-primary fill-primary/15" />
                          <span className="font-medium text-muted-foreground">..</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  )}

                  {sortedFolders.map((folder: S3Folder) => {
                    const folderName = folder.prefix.slice(currentPrefix.length, -1);
                    return (
                      <TableRow
                        key={folder.prefix}
                        onClick={() => handleNavigate(folder.prefix)}
                        className="cursor-pointer"
                      >
                        <TableCell className="font-medium pl-4">
                          <span className="flex items-center gap-2">
                            <Folder className="w-4 h-4 text-primary fill-primary/15 shrink-0" />
                            <span className="truncate">{folderName}</span>
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground font-mono text-xs">&mdash;</TableCell>
                        <TableCell className="text-right text-muted-foreground font-mono text-xs">&mdash;</TableCell>
                        <TableCell className="text-right pr-4"></TableCell>
                      </TableRow>
                    );
                  })}

                  {sortedObjects.map((obj: S3Object) => {
                    const fileName = obj.key.slice(currentPrefix.length);
                    const Icon = getFileIcon(fileName);
                    return (
                      <TableRow key={obj.key} className="group">
                        <TableCell className="font-medium pl-4">
                          <span className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[150px] sm:max-w-[300px]">{fileName}</span>
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground font-mono text-xs truncate">
                          {new Date(obj.last_modified).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground font-mono text-xs whitespace-nowrap tabular-nums">
                          {formatSize(obj.size)}
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <div className="flex items-center justify-end gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
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
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <File className="w-7 h-7 opacity-30" />
                          <p className="text-sm">{search ? 'No files match your search' : 'This folder is empty'}</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>

          {isDragOver && (
            <div className="absolute inset-1 rounded-md border-2 border-dashed border-primary bg-primary/5 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <UploadCloud className="w-6 h-6 text-primary" />
              <p className="text-sm font-medium text-primary">Drop to upload</p>
            </div>
          )}
        </div>
      </div>

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
