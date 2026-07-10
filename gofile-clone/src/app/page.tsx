'use client';

import { useState } from 'react';
import { Upload, Cloud, Lock, Clock, Share2, FolderOpen, File, Image, Video, FileText } from 'lucide-react';

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    setFiles(prev => [...prev, ...droppedFiles]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...selectedFiles]);
  };

  const uploadFile = async (file: File) => {
    // Simulate upload progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 20;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        
        // Add to uploaded files
        const newFile = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          size: file.size,
          type: file.type,
          url: `https://example.com/file/${Math.random().toString(36).substr(2, 9)}`,
          createdAt: new Date().toISOString(),
        };
        setUploadedFiles(prev => [...prev, newFile]);
      }
      setUploadProgress(prev => ({ ...prev, [file.name]: progress }));
    }, 200);
  };

  const handleUpload = () => {
    files.forEach(file => uploadFile(file));
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <Image className="w-5 h-5" />;
    if (type.startsWith('video/')) return <Video className="w-5 h-5" />;
    if (type.startsWith('text/') || type.includes('pdf')) return <FileText className="w-5 h-5" />;
    return <File className="w-5 h-5" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-black/50 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="w-8 h-8 text-blue-500" />
            <span className="text-2xl font-bold">GoFile Clone</span>
          </div>
          <nav className="flex items-center gap-6">
            <a href="#" className="text-gray-400 hover:text-white transition">API</a>
            <a href="#" className="text-gray-400 hover:text-white transition">Pricing</a>
            <button className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition">
              Sign Up
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12">
        {/* Upload Section */}
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              Share Files Instantly
            </h1>
            <p className="text-gray-400 text-lg">
              Drag and drop files or click to upload. No account required.
            </p>
          </div>

          {/* Upload Zone */}
          <div
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
              isDragging
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-700 hover:border-gray-500 bg-gray-900/50'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload className="w-16 h-16 mx-auto mb-4 text-gray-500" />
            <p className="text-xl mb-2">Drag and drop files here</p>
            <p className="text-gray-500 mb-4">or</p>
            <label className="inline-block bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg cursor-pointer transition">
              Browse Files
              <input
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </label>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="mt-8 bg-gray-900/50 rounded-xl p-6 border border-gray-800">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Files to Upload ({files.length})</h2>
                <button
                  onClick={handleUpload}
                  className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg transition flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Upload All
                </button>
              </div>
              <div className="space-y-3">
                {files.map((file, index) => (
                  <div key={index} className="flex items-center gap-4 p-4 bg-gray-800/50 rounded-lg">
                    {getFileIcon(file.type)}
                    <div className="flex-1">
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-gray-500">{formatFileSize(file.size)}</p>
                    </div>
                    {uploadProgress[file.name] !== undefined ? (
                      <div className="w-32">
                        <div className="bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all"
                            style={{ width: `${uploadProgress[file.name]}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1 text-center">
                          {Math.round(uploadProgress[file.name])}%
                        </p>
                      </div>
                    ) : (
                      <button
                        onClick={() => setFiles(prev => prev.filter((_, i) => i !== index))}
                        className="text-red-500 hover:text-red-400 transition"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Uploaded Files */}
          {uploadedFiles.length > 0 && (
            <div className="mt-8 bg-gray-900/50 rounded-xl p-6 border border-gray-800">
              <h2 className="text-xl font-semibold mb-4">Uploaded Files</h2>
              <div className="space-y-3">
                {uploadedFiles.map((file) => (
                  <div key={file.id} className="flex items-center gap-4 p-4 bg-gray-800/50 rounded-lg">
                    {getFileIcon(file.type)}
                    <div className="flex-1">
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-gray-500">{formatFileSize(file.size)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="text-blue-500 hover:text-blue-400 transition flex items-center gap-1">
                        <Share2 className="w-4 h-4" />
                        Share
                      </button>
                      <button className="text-gray-500 hover:text-gray-400 transition">
                        Copy Link
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Features Section */}
        <div className="max-w-6xl mx-auto mt-20">
          <h2 className="text-3xl font-bold text-center mb-12">Features</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-gray-900/50 p-6 rounded-xl border border-gray-800">
              <Cloud className="w-12 h-12 text-blue-500 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Cloud Storage</h3>
              <p className="text-gray-400">Store your files securely in the cloud with automatic backups.</p>
            </div>
            <div className="bg-gray-900/50 p-6 rounded-xl border border-gray-800">
              <Lock className="w-12 h-12 text-green-500 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Password Protection</h3>
              <p className="text-gray-400">Protect your files with password encryption for added security.</p>
            </div>
            <div className="bg-gray-900/50 p-6 rounded-xl border border-gray-800">
              <Clock className="w-12 h-12 text-purple-500 mb-4" />
              <h3 className="text-xl font-semibold mb-2">File Expiration</h3>
              <p className="text-gray-400">Set expiration dates for temporary file sharing.</p>
            </div>
            <div className="bg-gray-900/50 p-6 rounded-xl border border-gray-800">
              <Share2 className="w-12 h-12 text-yellow-500 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Easy Sharing</h3>
              <p className="text-gray-400">Share files with a simple link, no account required.</p>
            </div>
            <div className="bg-gray-900/50 p-6 rounded-xl border border-gray-800">
              <FolderOpen className="w-12 h-12 text-red-500 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Folder Uploads</h3>
              <p className="text-gray-400">Upload entire folders with preserved structure.</p>
            </div>
            <div className="bg-gray-900/50 p-6 rounded-xl border border-gray-800">
              <File className="w-12 h-12 text-cyan-500 mb-4" />
              <h3 className="text-xl font-semibold mb-2">File Previews</h3>
              <p className="text-gray-400">Preview images, videos, and PDFs directly in browser.</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-20 py-8">
        <div className="container mx-auto px-4 text-center text-gray-500">
          <p>&copy; 2024 GoFile Clone. Built with Next.js and Cloudflare R2.</p>
        </div>
      </footer>
    </div>
  );
}
