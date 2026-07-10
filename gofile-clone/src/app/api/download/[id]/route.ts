import { NextRequest, NextResponse } from 'next/server';
import { getFileRecord, incrementDownloadCount } from '@/lib/db';
import { getPresignedUrl, deleteFileFromR2 } from '@/lib/r2';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const fileRecord = await getFileRecord(params.id);

    // Check if file exists
    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Check if file has expired
    if (fileRecord.expires_at && new Date(fileRecord.expires_at) < new Date()) {
      await deleteFileFromR2(fileRecord.r2_key);
      return NextResponse.json({ error: 'File has expired' }, { status: 410 });
    }

    // Check password protection
    const password = request.nextUrl.searchParams.get('password');
    if (fileRecord.password && fileRecord.password !== password) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Check max downloads
    if (fileRecord.max_downloads && fileRecord.download_count >= fileRecord.max_downloads) {
      return NextResponse.json({ error: 'Download limit reached' }, { status: 410 });
    }

    // Get presigned URL from R2
    const downloadUrl = await getPresignedUrl(fileRecord.r2_key, 3600);

    // Increment download count
    await incrementDownloadCount(params.id);

    // Redirect to the presigned URL
    return NextResponse.redirect(downloadUrl);
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
