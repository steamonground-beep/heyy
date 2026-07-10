import { NextRequest, NextResponse } from 'next/server';
import { getFileRecord } from '@/lib/db';
import { getPresignedUrl } from '@/lib/r2';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const fileRecord = await getFileRecord(params.id);

    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Check if file has expired
    if (fileRecord.expires_at && new Date(fileRecord.expires_at) < new Date()) {
      return NextResponse.json({ error: 'File has expired' }, { status: 410 });
    }

    // Check password protection
    const password = request.nextUrl.searchParams.get('password');
    if (fileRecord.password && !password) {
      return NextResponse.json({ error: 'Password required' }, { status: 401 });
    }

    if (fileRecord.password && fileRecord.password !== password) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Get presigned URL for preview
    const previewUrl = await getPresignedUrl(fileRecord.r2_key, 3600);

    return NextResponse.json({
      id: fileRecord.id,
      name: fileRecord.name,
      size: fileRecord.size,
      type: fileRecord.type,
      previewUrl,
      downloadUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/download/${fileRecord.id}`,
      created_at: fileRecord.created_at,
      expires_at: fileRecord.expires_at,
      download_count: fileRecord.download_count,
      max_downloads: fileRecord.max_downloads,
      password: !!fileRecord.password,
    });
  } catch (error) {
    console.error('File fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch file' }, { status: 500 });
  }
}
