# GoFile Clone

A modern file sharing service built with Next.js, Cloudflare R2, and Supabase.

## Features

- ✅ Drag-and-drop file uploads
- ✅ Progress bars for uploads
- ✅ Shareable download links
- ✅ Folder uploads support
- ✅ Password-protected files
- ✅ File expiration options
- ✅ Multiple file uploads
- ✅ File previews (images, videos, PDFs)
- ✅ User accounts and dashboards (optional)
- ✅ Storage usage statistics
- ✅ Admin panel
- ✅ API for uploads
- ✅ Fast CDN-backed downloads

## Tech Stack

- **Frontend**: Next.js 14 with TypeScript
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL (Supabase)
- **Storage**: Cloudflare R2
- **CDN**: Cloudflare
- **Authentication**: Optional (Supabase Auth)

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Supabase account
- Cloudflare account with R2 enabled

### Setup

1. Clone the repository:
```bash
git clone https://github.com/your-username/gofile-clone.git
cd gofile-clone
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your credentials:
```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Cloudflare R2 Configuration
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=gofile-clone-files
R2_PUBLIC_URL=https://your-bucket.r2.dev

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
MAX_FILE_SIZE=104857600  # 100MB in bytes
```

### Database Setup

1. Go to your Supabase project SQL editor
2. Run the following SQL to create the tables:

```sql
-- Files table
CREATE TABLE files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  size BIGINT NOT NULL,
  type TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  password TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  download_count INTEGER DEFAULT 0,
  max_downloads INTEGER,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users table (for extended user info)
CREATE TABLE user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  storage_used BIGINT DEFAULT 0,
  storage_limit BIGINT DEFAULT 10737418240, -- 10GB default
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_files_user_id ON files(user_id);
CREATE INDEX idx_files_created_at ON files(created_at DESC);
CREATE INDEX idx_files_expires_at ON files(expires_at);
```

### Cloudflare R2 Setup

1. Create a Cloudflare account
2. Enable R2 in your account
3. Create a new bucket named `gofile-clone-files`
4. Get your API credentials (Account ID, Access Key ID, Secret Access Key)
5. Set up a custom domain for your bucket (optional but recommended for CDN)

### Running the App

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

### Vercel Deployment

1. Push your code to GitHub
2. Import the project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Environment Variables for Production

Make sure to set these in your Vercel project settings:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`
- `NEXT_PUBLIC_APP_URL` (your Vercel domain)
- `MAX_FILE_SIZE`

## API Endpoints

### Upload File
```
POST /api/upload
Content-Type: multipart/form-data

Body:
- file: File
- password: string (optional)
- expiresIn: number (optional, hours)
- userId: string (optional)

Response:
{
  "success": true,
  "file": {
    "id": "uuid",
    "name": "filename",
    "size": 12345,
    "type": "image/jpeg",
    "url": "https://yourdomain.com/f/uuid",
    "downloadUrl": "https://yourdomain.com/api/download/uuid",
    "createdAt": "2024-01-01T00:00:00Z",
    "expiresAt": "2024-01-02T00:00:00Z"
  }
}
```

### Get File Info
```
GET /api/file/:id?password=optional

Response:
{
  "id": "uuid",
  "name": "filename",
  "size": 12345,
  "type": "image/jpeg",
  "previewUrl": "presigned_url",
  "downloadUrl": "https://yourdomain.com/api/download/uuid",
  "created_at": "2024-01-01T00:00:00Z",
  "expires_at": "2024-01-02T00:00:00Z",
  "download_count": 5,
  "max_downloads": 10,
  "password": true
}
```

### Download File
```
GET /api/download/:id?password=optional

Response: Redirects to the file
```

## Features in Detail

### File Upload
- Drag and drop support
- Multiple file selection
- Progress tracking
- Size validation (configurable max size)
- File type validation

### Security
- Password protection for files
- Expiration dates
- Download limits
- Secure presigned URLs
- CORS protection

### User Features (Optional)
- User registration/login
- Personal dashboard
- File management
- Storage usage tracking
- Download history

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for any purpose.

## Support

For issues and questions, please open an issue on GitHub.
