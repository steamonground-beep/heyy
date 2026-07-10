import { NextRequest, NextResponse } from 'next/server';
import { uploadFileToR2 } from '@/lib/r2';
import { createFileRecord } from '@/lib/db';
import { randomBytes } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string | null;
    const expiresIn = formData.get('expiresIn') as string | null;
    const userId = formData.get('userId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Check file size (max 100MB)
    const maxSize = parseInt(process.env.MAX_FILE_SIZE || '104857600');
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File too large' }, { status: 400 });
    }

    // Generate unique key for R2
    const fileKey = `${randomBytes(16).toString('hex')}-${file.name}`;

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Upload to R2
    const fileUrl = await uploadFileToR2(fileKey, buffer, file.type);

    // Calculate expiration date
    let expiresAt = null;
    if (expiresIn) {
      const expiryDate = new Date();
      expiryDate.setHours(expiryDate.getHours() + parseInt(expiresIn));
      expiresAt = expiryDate.toISOString();
    }

    // Create database record
    const fileRecord = await createFileRecord({
      name: file.name,
      size: file.size,
      type: file.type,
      r2_key: fileKey,
      password: password || undefined,
      expires_at: expiresAt || undefined,
      user_id: userId || undefined,
    });

    return NextResponse.json({
      success: true,
      file: {
        id: fileRecord.id,
        name: fileRecord.name,
        size: fileRecord.size,
        type: fileRecord.type,
        url: `${process.env.NEXT_PUBLIC_APP_URL}/f/${fileRecord.id}`,
        downloadUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/download/${fileRecord.id}`,
        createdAt: fileRecord.created_at,
        expiresAt: fileRecord.expires_at,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
