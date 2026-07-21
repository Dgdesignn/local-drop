require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const cors = require('cors');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = (process.env.MAX_FILE_SIZE_MB || 5000) * 1024 * 1024;
const ALLOWED_EXTS = (process.env.ALLOWED_EXTENSIONS || '').split(',').filter(Boolean);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');

// Configuração CORS segura
app.use(cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(compression()); // Compressão gzip/brotli para todas as respostas
app.use(express.json());

const baseUploadDir = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
const tempDir = path.resolve(__dirname, '..', process.env.TEMP_DIR || 'temp');

// Garante que os diretórios existam
if (!fs.existsSync(baseUploadDir)) fs.mkdirSync(baseUploadDir, { recursive: true });
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({ dest: tempDir });

app.use(express.static(path.join(__dirname, '../public')));

// ============ Helpers de Segurança ============
const isValidFolderName = (name) => /^[a-zA-Z0-9-_ ]+$/.test(name);
const getSafeFolderPath = (folderName) => {
    if (!folderName) return baseUploadDir;
    const safeName = path.basename(folderName);
    return path.join(baseUploadDir, safeName);
};

// ============ Limpeza de chunks órfãos (promisificada) ============
setInterval(async () => {
    try {
        const files = await fsp.readdir(tempDir);
        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            const stats = await fsp.stat(filePath);
            if (now - stats.mtimeMs > 2 * 60 * 60 * 1000) { // 2 horas
                await fsp.unlink(filePath);
                console.log(`[Cleanup] Chunk órfão removido: ${file}`);
            }
        }
    } catch (err) {
        console.error('[Cleanup] Erro na limpeza:', err.message);
    }
}, 60 * 60 * 1000); // A cada 1 hora

// ============ Rotas ============

// Listar pastas
app.get('/folders', (req, res) => {
    try {
        const files = fs.readdirSync(baseUploadDir, { withFileTypes: true });
        const folders = files.filter(item => item.isDirectory()).map(item => item.name);
        res.json(folders);
    } catch (error) {
        console.error('Erro ao listar pastas:', error);
        res.status(500).json({ error: 'Erro interno ao listar pastas.' });
    }
});

// Listar arquivos de uma pasta
app.get('/files', (req, res) => {
    const targetFolder = getSafeFolderPath(req.query.folder);
    if (!targetFolder.startsWith(baseUploadDir) || !fs.existsSync(targetFolder)) {
        return res.status(400).json({ error: 'Caminho inválido ou inexistente.' });
    }
    
    try {
        const files = fs.readdirSync(targetFolder, { withFileTypes: true })
            .filter(item => item.isFile())
            .map(item => {
                const stats = fs.statSync(path.join(targetFolder, item.name));
                return { name: item.name, size: stats.size, date: stats.mtime };
            });
        res.json(files);
    } catch (error) {
        console.error('Erro ao ler arquivos:', error);
        res.status(500).json({ error: 'Erro ao ler arquivos.' });
    }
});

// Criar pasta
app.post('/folders', (req, res) => {
    const { folderName } = req.body;
    if (!folderName || !isValidFolderName(folderName)) {
        return res.status(400).json({ error: 'Nome de pasta inválido. Use apenas letras, números, espaços, hífens e underlines.' });
    }
    const newFolderPath = path.join(baseUploadDir, folderName);
    if (fs.existsSync(newFolderPath)) return res.status(400).json({ error: 'Pasta já existe.' });
    fs.mkdirSync(newFolderPath, { recursive: true });
    res.status(201).json({ message: 'Pasta criada!', folder: folderName });
});

// Upload de Chunks (com streaming e segurança reforçada)
app.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
    let tempFilePath = req.file?.path;
    try {
        const { chunkIndex, totalChunks, fileName, folder, fileSize, originalFileName } = req.body;
        const index = parseInt(chunkIndex);
        const total = parseInt(totalChunks);
        const totalSize = parseInt(fileSize);

        // Validações apenas no primeiro chunk
        if (index === 0) {
            if (totalSize > MAX_FILE_SIZE) {
                throw new Error('Arquivo excede o tamanho máximo permitido.');
            }
            const rawName = originalFileName || fileName; // primeiro chunk envia nome original
            const ext = rawName.split('.').pop().toLowerCase();
            if (ALLOWED_EXTS.length > 0 && !ALLOWED_EXTS.includes(ext)) {
                throw new Error(`Tipo de arquivo não permitido: .${ext}`);
            }
            // Armazenar nome original para uso no último chunk (passado via originalFileName)
            // O fileName sanitizado será usado para salvar
        }

        // Sanitiza o nome do arquivo para evitar path traversal
        const safeFileName = path.basename(fileName);
        const safeFolder = getSafeFolderPath(folder);
        if (!safeFolder.startsWith(baseUploadDir)) throw new Error('Tentativa de Directory Traversal.');

        // Move o chunk recebido para o local correto
        const partPath = path.join(tempDir, `${safeFileName}.part_${index}`);
        await fsp.rename(tempFilePath, partPath);
        tempFilePath = null; // já foi movido

        // Concatenação no último chunk usando streams
        if (index === total - 1) {
            if (!fs.existsSync(safeFolder)) await fsp.mkdir(safeFolder, { recursive: true });

            // Verifica se já existe arquivo com o mesmo nome e gera um novo nome se necessário
            let finalName = safeFileName;
            let finalPath = path.join(safeFolder, finalName);
            let counter = 1;
            while (fs.existsSync(finalPath)) {
                const ext = path.extname(safeFileName);
                const base = path.basename(safeFileName, ext);
                finalName = `${base}(${counter})${ext}`;
                finalPath = path.join(safeFolder, finalName);
                counter++;
            }

            const writeStream = fs.createWriteStream(finalPath);
            for (let i = 0; i < total; i++) {
                const currentPart = path.join(tempDir, `${safeFileName}.part_${i}`);
                if (!fs.existsSync(currentPart)) {
                    throw new Error(`Chunk ${i} faltando. Upload inconsistente.`);
                }
                const readStream = fs.createReadStream(currentPart);
                await new Promise((resolve, reject) => {
                    readStream.pipe(writeStream, { end: false });
                    readStream.on('end', resolve);
                    readStream.on('error', reject);
                });
                await fsp.unlink(currentPart); // remove chunk após uso
            }
            writeStream.end();

            // Verifica o tamanho final do arquivo
            const finalStats = await fsp.stat(finalPath);
            if (finalStats.size !== totalSize) {
                await fsp.unlink(finalPath);
                throw new Error('Tamanho do arquivo reconstruído não corresponde ao declarado.');
            }

            console.log(`[Upload] Completo: ${finalName} (${(finalStats.size / 1024 / 1024).toFixed(2)} MB)`);
            return res.status(200).json({ message: 'Upload completo!', fileName: finalName });
        }

        res.status(200).json({ message: `Chunk ${index} recebido.` });
    } catch (error) {
        // Remove o arquivo temporário se ainda existir
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            await fsp.unlink(tempFilePath).catch(() => {});
        }
        console.error(`[Upload Error] ${error.message}`);
        res.status(error.status || 500).json({ error: error.message || 'Erro interno no processamento do chunk.' });
    }
});

// Download com suporte a Range requests
app.get('/download', (req, res) => {
    const folder = req.query.folder || '';
    const rawFileName = req.query.file;
    
    if (!rawFileName) return res.status(400).json({ error: 'Nome do arquivo não informado.' });
    
    const safeFileName = path.basename(rawFileName);
    const safeFolder = getSafeFolderPath(folder);
    
    if (!safeFolder.startsWith(baseUploadDir)) {
        return res.status(403).json({ error: 'Acesso negado.' });
    }
    
    const filePath = path.join(safeFolder, safeFileName);
    
    if (!fs.existsSync(filePath) || !filePath.startsWith(baseUploadDir)) {
        return res.status(404).json({ error: 'Arquivo não encontrado.' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${safeFileName}"`
        };
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${safeFileName}"`,
            'Accept-Ranges': 'bytes'
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
    }
});

// Tratamento global de erros
app.use((err, req, res, next) => {
    console.error('[Erro não capturado]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});