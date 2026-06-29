# Key System - JSON-based License Management

Simple JSON-based key system with IP locking for UABEANext. No website required - just run the server locally.

## Features

- **IP Locking**: Keys lock to the user's public IP address on first use
- **Expiry Dates**: Keys can have optional expiry dates
- **JSON Storage**: All keys stored in a simple JSON file
- **CLI Tool**: Easy command-line tool to generate keys
- **HTTP API**: Simple API for UABEANext validation

## Setup

### 1. Install Dependencies

```bash
cd KeySystem
npm install
```

### 2. Start the Server

```bash
npm start
```

The server will run on `http://localhost:3001`

## Usage

### Generate Keys

**Using the CLI tool:**
```bash
# Generate a key that never expires
npm run add-key

# Generate a key that expires in 30 days
npm run add-key 30

# Generate a key with a label
npm run add-key 30 "Customer Name"
```

**Using the API:**
```bash
curl -X POST http://localhost:3001/api/keys \
  -H "Content-Type: application/json" \
  -d '{"expiryDays": 30, "label": "Customer Name"}'
```

### View All Keys

```bash
curl http://localhost:3001/api/keys
```

### Reset a Key's IP Lock

```bash
curl -X POST http://localhost:3001/api/keys/XXXX-XXXX-XXXX-XXXX/reset
```

### Delete a Key

```bash
curl -X DELETE http://localhost:3001/api/keys/XXXX-XXXX-XXXX-XXXX
```

## Key Format

Keys are stored in `keys.json` with this format:

```json
[
  {
    "key": "ABCD-1234-EFGH-5678",
    "label": "Customer Name",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "expiresAt": "2024-01-31T00:00:00.000Z",
    "usedIp": null,
    "usedAt": null
  }
]
```

- **key**: The license key (format: XXXX-XXXX-XXXX-XXXX)
- **label**: Optional label for the key
- **createdAt**: When the key was created
- **expiresAt**: When the key expires (null = never)
- **usedIp**: IP address the key is locked to (null = unused)
- **usedAt**: When the key was first used

## How It Works

1. **Key Creation**: You generate keys using the CLI or API
2. **First Use**: When a user enters a key in UABEANext:
   - UABEANext gets the user's public IP
   - Sends key + IP to the validation server
   - Server checks if key exists and is not expired
   - If key is unused, it locks to that IP
   - If key is already used, it checks if IP matches
3. **Validation**: Key is valid only if:
   - Key exists in `keys.json`
   - Key is not expired
   - Key is locked to the user's IP (or unused)

## API Endpoints

### POST /api/validate
Validates a license key and locks it to an IP.

**Request:**
```json
{
  "key": "ABCD-1234-EFGH-5678",
  "ip": "1.2.3.4"
}
```

**Response:**
```json
{
  "valid": true,
  "message": "License activated and locked to IP",
  "lockedIp": "1.2.3.4"
}
```

### POST /api/keys
Creates a new key.

**Request:**
```json
{
  "key": "ABCD-1234-EFGH-5678",
  "expiryDays": 30,
  "label": "Customer Name"
}
```

### GET /api/keys
Lists all keys.

### DELETE /api/keys/:key
Deletes a key.

### POST /api/keys/:key/reset
Resets the IP lock on a key (allows it to be used on a different IP).

## Security Notes

- This is a simple system for personal use
- Keys are stored in plain text JSON
- IP locking can be bypassed with VPNs
- For production use, consider:
  - Using a database instead of JSON
  - Adding authentication to the API
  - Using hardware ID instead of IP
  - Encrypting the keys file

## Troubleshooting

**Server won't start:** Make sure port 3001 is not in use

**Key validation fails:** Check that the KeySystem server is running

**IP keeps changing:** If user has dynamic IP, use the reset endpoint to re-lock the key
