import { supabase } from './supabase';

export interface FileRecord {
  id: string;
  name: string;
  size: number;
  type: string;
  r2_key: string;
  password?: string;
  expires_at?: string;
  download_count: number;
  max_downloads?: number;
  user_id?: string;
  created_at: string;
}

export async function createFileRecord(file: Omit<FileRecord, 'id' | 'created_at' | 'download_count'>) {
  const { data, error } = await supabase
    .from('files')
    .insert({
      ...file,
      download_count: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getFileRecord(id: string) {
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function incrementDownloadCount(id: string) {
  const { data, error } = await supabase
    .from('files')
    .update({ download_count: supabase.raw('download_count + 1') })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteFileRecord(id: string) {
  const { error } = await supabase
    .from('files')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function getUserFiles(userId: string) {
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function getUserStorageUsage(userId: string) {
  const { data, error } = await supabase
    .from('files')
    .select('size')
    .eq('user_id', userId);

  if (error) throw error;
  
  const totalSize = data?.reduce((sum, file) => sum + file.size, 0) || 0;
  return totalSize;
}
