'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Download, Share2, Lock, Clock, File, Image as ImageIcon, Video, FileText, Eye } from 'lucide-react';

export default function FilePage() {
  const params = useParams();
  const [file, setFile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchFile();
  }, [params.id]);

  const fetchFile = async () => {
    try {
      const response = await fetch(`/api/file/${params.id}`);
      const data = await response.json();
      
      if (data.error) {
        if (data.error === 'Password required') {
          setPasswordRequired(true);
        } else {
          setError(data.error);
        }
      } else {
        setFile(data);
      }
    } catch (err) {
      setError('Failed to load file');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`/api/file/${params.id}?password=${password}`);
      const data = await response.json();
      
      if (data.error) {
        setError('Invalid password');
      } else {
        setFile(data);
        setPasswordRequired(false);
      }
    } catch (err) {
      setError('Authentication failed');
    }
  };

  const handleDownload = async () => {
    const downloadUrl = file.downloadUrl + (password ? `?password=${password}` : '');
    window.open(downloadUrl, '_blank');
  };

  const handleShare = async () => {
    const shareUrl = window.location.href;
    await navigator.clipboard.writeText(shareUrl);
    alert('Link copied to clipboard!');
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-8 h-8" />;
    if (type.startsWith('video/')) return <Video className="w-8 h-8" />;
    if (type.startsWith('text/') || type.includes('pdf')) return <FileText className="w-8 h-8" />;
    return <File className="w-8 h-8" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">{error}</p>
          <button onClick={() => window.location.href = '/'} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg">
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (passwordRequired) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 flex items-center justify-center">
        <div className="bg-gray-900/50 p-8 rounded-xl border border-gray-800 max-w-md w-full">
          <div className="text-center mb-6">
            <Lock className="w-12 h-12 mx-auto mb-4 text-blue-500" />
            <h2 className="text-2xl font-bold text-white mb-2">Password Required</h2>
            <p className="text-gray-400">This file is password protected</p>
          </div>
          <form onSubmit={handlePasswordSubmit}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white mb-4"
            />
            {error && <p className="text-red-500 mb-4">{error}</p>}
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg text-white transition"
            >
              Unlock File
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-black/50 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <File className="w-6 h-6 text-blue-500" />
            <span className="text-xl font-bold">GoFile Clone</span>
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          {/* File Info Card */}
          <div className="bg-gray-900/50 rounded-xl p-8 border border-gray-800 mb-8">
            <div className="flex items-start gap-6 mb-6">
              <div className="bg-gray-800 p-4 rounded-lg">
                {getFileIcon(file.type)}
              </div>
              <div className="flex-1">
                <h1 className="text-2xl font-bold mb-2">{file.name}</h1>
                <div className="flex items-center gap-4 text-gray-400 text-sm">
                  <span>{formatFileSize(file.size)}</span>
                  <span>•</span>
                  <span>{file.type}</span>
                  <span>•</span>
                  <span>{file.download_count} downloads</span>
                </div>
              </div>
            </div>

            {/* File Preview */}
            {file.type.startsWith('image/') && (
              <div className="mb-6">
                <img
                  src={file.previewUrl}
                  alt={file.name}
                  className="max-w-full h-auto rounded-lg"
                />
              </div>
            )}

            {file.type.startsWith('video/') && (
              <div className="mb-6">
                <video
                  src={file.previewUrl}
                  controls
                  className="w-full rounded-lg"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-4">
              <button
                onClick={handleDownload}
                className="flex-1 bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg transition flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                Download
              </button>
              <button
                onClick={handleShare}
                className="flex-1 bg-gray-700 hover:bg-gray-600 px-6 py-3 rounded-lg transition flex items-center justify-center gap-2"
              >
                <Share2 className="w-5 h-5" />
                Share
              </button>
            </div>

            {/* File Details */}
            <div className="mt-6 pt-6 border-t border-gray-800">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 mb-1">Uploaded</p>
                  <p>{new Date(file.created_at).toLocaleDateString()}</p>
                </div>
                {file.expires_at && (
                  <div>
                    <p className="text-gray-500 mb-1">Expires</p>
                    <p className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {new Date(file.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                )}
                {file.max_downloads && (
                  <div>
                    <p className="text-gray-500 mb-1">Download Limit</p>
                    <p className="flex items-center gap-1">
                      <Eye className="w-4 h-4" />
                      {file.download_count} / {file.max_downloads}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
