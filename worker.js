// worker.js - Professional Media Upload API with Custom URLs

const BOT_TOKEN = '8360624116:AAEEJha8CRgL8TnrEKk5zOuCNXXRawmbuaE';
const CHANNEL_ID = '-1003071466750';
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (path === '/' && request.method === 'GET') {
      return new Response(getHTMLContent(), {
        headers: { 'Content-Type': 'text/html', ...corsHeaders }
      });
    }

    if (path === '/upload' && request.method === 'POST') {
      return await handleFileUpload(request, corsHeaders);
    }

    if (path === '/hosturl' && request.method === 'GET') {
      return await handleURLUpload(request, corsHeaders);
    }

    if (path.startsWith('/img/') && request.method === 'GET') {
      return await handleImageRequest(request, corsHeaders);
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Internal server error: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

async function handleFileUpload(request, corsHeaders) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file uploaded' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (file.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: 'File too large (max 20MB)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Upload to Telegram and get custom URL
    const result = await uploadToTelegramWithCustomURL(file, request);
    
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Upload failed: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

async function handleURLUpload(request, corsHeaders) {
  try {
    const url = new URL(request.url);
    const fileUrl = url.searchParams.get('url');

    if (!fileUrl) {
      return new Response(JSON.stringify({ error: 'No URL provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const fileResponse = await fetch(fileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MediaUploader/1.0)' }
    });

    if (!fileResponse.ok) {
      return new Response(JSON.stringify({ 
        error: 'Failed to download file from URL' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const fileBlob = await fileResponse.blob();
    
    if (fileBlob.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: 'File too large (max 20MB)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const filename = fileUrl.split('/').pop() || 'downloaded_file';
    const file = new File([fileBlob], filename, { type: fileBlob.type });

    const result = await uploadToTelegramWithCustomURL(file, request);
    
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'URL upload failed: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

async function handleImageRequest(request, corsHeaders) {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('id') || url.pathname.split('/').pop();
    
    if (!fileId) {
      return new Response('File not found', { status: 404, headers: corsHeaders });
    }

    // Get original URL from KV storage
    const originalUrl = await MARYA_STORAGE.get(fileId);
    
    if (!originalUrl) {
      return new Response('File not found', { status: 404, headers: corsHeaders });
    }

    // Fetch from Telegram and serve
    const response = await fetch(originalUrl);
    
    if (!response.ok) {
      return new Response('File not found', { status: 404, headers: corsHeaders });
    }

    const fileBlob = await response.blob();
    
    return new Response(fileBlob, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000',
        ...corsHeaders
      }
    });

  } catch (error) {
    return new Response('File not found', { status: 404, headers: corsHeaders });
  }
}

async function uploadToTelegramWithCustomURL(file, request) {
  try {
    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`;

    const formData = new FormData();
    formData.append('chat_id', CHANNEL_ID);
    formData.append('document', file);

    const response = await fetch(telegramUrl, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (result.ok) {
      const fileId = result.result.document.file_id;
      const filePath = await getFilePath(fileId);

      if (filePath) {
        const originalUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        
        // Generate custom URL
        const customId = generateCustomId(file);
        const customUrl = generateCustomURL(request, customId, file.name);
        
        // Store mapping in KV
        await MARYA_STORAGE.put(customId, originalUrl, {
          metadata: {
            filename: file.name,
            size: file.size,
            type: file.type,
            uploaded: new Date().toISOString()
          }
        });

        return {
          data: customUrl,
          url: customUrl,
          filename: file.name,
          size: file.size,
          uploaded_on: new Date().toISOString(),
          media_type: file.type,
          creator: 'https://marya-database.btfcompanystorage.workers.dev'
        };
      }
    }

    return { 
      error: 'Upload failed to Telegram',
      debug: result
    };

  } catch (error) {
    return { error: 'Telegram API error: ' + error.message };
  }
}

function generateCustomId(file) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomPart = Array.from({length: 8}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const timestamp = Date.now().toString(36);
  return `${randomPart}${timestamp}`;
}

function generateCustomURL(request, customId, filename) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.hostname}`;
  
  // Get file extension
  const extension = filename.split('.').pop()?.toLowerCase() || 'file';
  
  // Generate format like: /img/ABC123XYZ.jpg?id=customId
  return `${baseUrl}/img/${customId}.${extension}?id=${customId}`;
}

async function getFilePath(fileId) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
    );
    const result = await response.json();

    if (result.ok) {
      return result.result.file_path;
    }
    return null;
  } catch {
    return null;
  }
}

function getHTMLContent() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Marya Media Uploader - Professional Image & Video Hosting</title>
    <link rel="icon" type="image/x-icon" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f8fafc;
            color: #334155;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 40px 0;
        }
        
        .header h1 {
            font-size: 3rem;
            font-weight: 700;
            color: #1e293b;
            margin-bottom: 16px;
        }
        
        .header p {
            font-size: 1.25rem;
            color: #64748b;
            max-width: 600px;
            margin: 0 auto;
        }
        
        .main-card {
            background: white;
            border-radius: 16px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            overflow: hidden;
            margin-bottom: 32px;
        }
        
        .card-header {
            background: linear-gradient(135deg, #3b82f6, #1d4ed8);
            color: white;
            padding: 24px;
            text-align: center;
        }
        
        .card-header h2 {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .card-body {
            padding: 32px;
        }
        
        .upload-zone {
            border: 2px dashed #cbd5e1;
            border-radius: 12px;
            padding: 48px 24px;
            text-align: center;
            transition: all 0.3s ease;
            cursor: pointer;
            background: #f8fafc;
        }
        
        .upload-zone:hover {
            border-color: #3b82f6;
            background: #eff6ff;
        }
        
        .upload-zone.dragover {
            border-color: #1d4ed8;
            background: #dbeafe;
            transform: scale(1.02);
        }
        
        .upload-icon {
            color: #3b82f6;
            margin-bottom: 16px;
        }
        
        .upload-text {
            font-size: 1.125rem;
            font-weight: 500;
            color: #374151;
            margin-bottom: 8px;
        }
        
        .upload-subtext {
            color: #9ca3af;
            font-size: 0.875rem;
        }
        
        input[type="file"] {
            display: none;
        }
        
        .url-section {
            margin-top: 32px;
            padding-top: 32px;
            border-top: 1px solid #e5e7eb;
        }
        
        .section-title {
            font-size: 1.125rem;
            font-weight: 600;
            color: #374151;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .input-group {
            display: flex;
            gap: 12px;
            align-items: stretch;
        }
        
        .url-input {
            flex: 1;
            padding: 12px 16px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 16px;
            outline: none;
            transition: all 0.2s ease;
        }
        
        .url-input:focus {
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        .btn {
            background: linear-gradient(135deg, #3b82f6, #1d4ed8);
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        
        .btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .result {
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 24px;
            margin: 16px 0;
            word-break: break-all;
        }
        
        .result.success {
            background: #f0fdf4;
            border-color: #bbf7d0;
        }
        
        .result.error {
            background: #fef2f2;
            border-color: #fecaca;
            color: #dc2626;
        }
        
        .result-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            margin-bottom: 16px;
        }
        
        .result-content p {
            margin: 8px 0;
        }
        
        .copy-btn {
            background: #10b981;
            font-size: 12px;
            padding: 6px 12px;
            margin-left: 8px;
        }
        
        .loading {
            display: none;
            text-align: center;
            color: #3b82f6;
            font-weight: 500;
            padding: 24px;
        }
        
        .loading.show {
            display: block;
        }
        
        .spinner {
            border: 3px solid #e5e7eb;
            border-top: 3px solid #3b82f6;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            animation: spin 1s linear infinite;
            margin: 16px auto;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 24px;
            margin-top: 48px;
        }
        
        .feature {
            background: white;
            padding: 32px;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
            transition: all 0.2s ease;
        }
        
        .feature:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        
        .feature-icon {
            color: #3b82f6;
            margin-bottom: 16px;
        }
        
        .feature h3 {
            font-size: 1.25rem;
            font-weight: 600;
            color: #374151;
            margin-bottom: 8px;
        }
        
        .feature p {
            color: #6b7280;
            line-height: 1.6;
        }
        
        .footer {
            text-align: center;
            margin-top: 48px;
            padding: 24px;
            color: #9ca3af;
            border-top: 1px solid #e5e7eb;
        }
        
        @media (max-width: 768px) {
            .input-group {
                flex-direction: column;
            }
            
            .btn {
                width: 100%;
                justify-content: center;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .container {
                padding: 12px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Marya Media Uploader</h1>
            <p>Professional, fast, and reliable image & video hosting platform powered by advanced cloud infrastructure</p>
        </div>
        
        <div class="main-card">
            <div class="card-header">
                <h2><i class="fas fa-cloud-upload-alt"></i> Upload Your Media</h2>
                <p>Drag and drop files or click to browse from your device</p>
            </div>
            
            <div class="card-body">
                <div class="upload-zone" onclick="document.getElementById('fileInput').click()" ondrop="dropHandler(event);" ondragover="dragOverHandler(event);" ondragenter="dragEnterHandler(event);" ondragleave="dragLeaveHandler(event);">
                    <div class="upload-icon">
                        <i class="fas fa-cloud-upload-alt fa-4x"></i>
                    </div>
                    <div class="upload-text">Drop files here or click to browse</div>
                    <div class="upload-subtext">Supports images and videos up to 20MB</div>
                    <input type="file" id="fileInput" accept="image/*,video/*" multiple>
                </div>
                
                <div class="url-section">
                    <div class="section-title">
                        <i class="fas fa-link"></i>
                        Upload from URL
                    </div>
                    <div class="input-group">
                        <input type="url" id="urlInput" class="url-input" placeholder="Enter image or video URL...">
                        <button class="btn" onclick="uploadFromUrl()" id="urlBtn">
                            <i class="fas fa-download"></i>
                            Upload from URL
                        </button>
                    </div>
                </div>
                
                <div class="loading" id="loading">
                    <div class="spinner"></div>
                    <div>Processing your upload...</div>
                </div>
            </div>
        </div>
        
        <div id="results"></div>
        
        <div class="features">
            <div class="feature">
                <div class="feature-icon">
                    <i class="fas fa-bolt fa-3x"></i>
                </div>
                <h3>Lightning Fast</h3>
                <p>Powered by Cloudflare's global edge network for instant uploads and downloads worldwide</p>
            </div>
            <div class="feature">
                <div class="feature-icon">
                    <i class="fas fa-shield-alt fa-3x"></i>
                </div>
                <h3>Secure & Reliable</h3>
                <p>Enterprise-grade security with redundant cloud storage ensuring your files are always available</p>
            </div>
            <div class="feature">
                <div class="feature-icon">
                    <i class="fas fa-gift fa-3x"></i>
                </div>
                <h3>Completely Free</h3>
                <p>No hidden costs, no registration required. Professional hosting without any limitations</p>
            </div>
        </div>
        
        <div class="footer">
            <p><i class="fas fa-server"></i> Powered by Cloudflare Workers & Advanced Cloud Infrastructure</p>
        </div>
    </div>
    
    <script>
        document.getElementById('fileInput').addEventListener('change', function() {
            const files = this.files;
            for (let i = 0; i < files.length; i++) {
                uploadFile(files[i]);
            }
        });
        
        function uploadFile(file) {
            if (file.size > 20 * 1024 * 1024) {
                showResult({error: 'File too large. Maximum size is 20MB.'});
                return;
            }
            
            showLoading(true);
            
            const formData = new FormData();
            formData.append('file', file);
            
            fetch('/upload', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                showLoading(false);
                showResult(data);
            })
            .catch(error => {
                showLoading(false);
                showResult({error: 'Network error: ' + error.message});
            });
        }
        
        function uploadFromUrl() {
            const url = document.getElementById('urlInput').value.trim();
            if (!url) {
                alert('Please enter a URL');
                return;
            }
            
            showLoading(true);
            document.getElementById('urlBtn').disabled = true;
            
            fetch(\`/hosturl?url=\${encodeURIComponent(url)}\`)
            .then(response => response.json())
            .then(data => {
                showLoading(false);
                document.getElementById('urlBtn').disabled = false;
                showResult(data);
                if (!data.error) {
                    document.getElementById('urlInput').value = '';
                }
            })
            .catch(error => {
                showLoading(false);
                document.getElementById('urlBtn').disabled = false;
                showResult({error: 'Network error: ' + error.message});
            });
        }
        
        function showResult(data) {
            const resultsDiv = document.getElementById('results');
            const timestamp = new Date().toLocaleTimeString();
            
            if (data.error) {
                resultsDiv.innerHTML = \`
                    <div class="result error">
                        <div class="result-header">
                            <i class="fas fa-exclamation-triangle"></i>
                            Upload Failed
                        </div>
                        <div class="result-content">
                            <p><strong>Error:</strong> \${data.error}</p>
                            <p><small><i class="far fa-clock"></i> \${timestamp}</small></p>
                        </div>
                    </div>
                \` + resultsDiv.innerHTML;
            } else {
                resultsDiv.innerHTML = \`
                    <div class="result success">
                        <div class="result-header">
                            <i class="fas fa-check-circle"></i>
                            Upload Successful
                        </div>
                        <div class="result-content">
                            <p><strong>Direct URL:</strong> 
                                <a href="\${data.url}" target="_blank">\${data.url}</a>
                                <button class="btn copy-btn" onclick="copyToClipboard('\${data.url}')">
                                    <i class="far fa-copy"></i> Copy
                                </button>
                            </p>
                            <p><strong>Filename:</strong> \${data.filename}</p>
                            <p><strong>Size:</strong> \${(data.size / 1024).toFixed(1)} KB</p>
                            <p><strong>Type:</strong> \${data.media_type}</p>
                            <p><small><i class="far fa-clock"></i> \${timestamp}</small></p>
                        </div>
                    </div>
                \` + resultsDiv.innerHTML;
            }
        }
        
        function showLoading(show) {
            const loading = document.getElementById('loading');
            if (show) {
                loading.classList.add('show');
            } else {
                loading.classList.remove('show');
            }
        }
        
        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(function() {
                // Show success feedback
                const btn = event.target.closest('.copy-btn');
                const originalText = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Copied';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                }, 2000);
            });
        }
        
        // Drag and Drop functionality
        function dragOverHandler(ev) {
            ev.preventDefault();
            ev.dataTransfer.dropEffect = "copy";
        }
        
        function dragEnterHandler(ev) {
            ev.preventDefault();
            document.querySelector('.upload-zone').classList.add('dragover');
        }
        
        function dragLeaveHandler(ev) {
            ev.preventDefault();
            document.querySelector('.upload-zone').classList.remove('dragover');
        }
        
        function dropHandler(ev) {
            ev.preventDefault();
            document.querySelector('.upload-zone').classList.remove('dragover');
            
            const files = ev.dataTransfer.files;
            for (let i = 0; i < files.length; i++) {
                uploadFile(files[i]);
            }
        }
        
        // Enter key support for URL input
        document.getElementById('urlInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                uploadFromUrl();
            }
        });
    </script>
</body>
</html>
  `;
}