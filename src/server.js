require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = (process.env.MAX_FILE_SIZE_MB || 5000) * 1024 * 1024;
const ALLOWED_EXTS = (process.env.ALLOWED_EXTENSIONS || '').split(',');

app.use(cors());
app.use(express.json());

const baseUploadDir = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
const tempDir = path.resolve(__dirname, '..', process.env.TEMP_DIR || 'temp');

if (!fs.existsSync(baseUploadDir)) fs.mkdirSync(baseUploadDir, { recursive: true });
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({ dest: tempDir });

app.use(express.static(path.join(__dirname, '../public')));

// Helpers de Segurança
const isValidFolderName = (name) => /^[a-zA-Z0-9-_ ]+$/.test(name);
const getSafeFolderPath = (folderName) => {
    if (!folderName) return baseUploadDir;
    const safeName = path.basename(folderName);
    return path.join(baseUploadDir, safeName);
};

// Rotina de Limpeza: Remove chunks órfãos mais velhos que 2 horas
setInterval(() => {
    const now = Date.now();
    fs.readdir(tempDir, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > 2 * 60 * 60 * 1000) { // 2 horas
                    fs.unlink(filePath, () => console.log(`[Cleanup] Chunk órfão removido: ${file}`));
                }
            });
        });
    });
}, 60 * 60 * 1000); // Roda a cada 1 hora

// Rota: Listar pastas
app.get('/folders', (req, res) => {
    try {
        const files = fs.readdirSync(baseUploadDir, { withFileTypes: true });
        const folders = files.filter(item => item.isDirectory()).map(item => item.name);
        res.json(folders);
    } catch (error) {
        res.status(500).json({ error: 'Erro interno ao listar pastas.' });
    }
});

// Rota: Listar arquivos de uma pasta
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
        res.status(500).json({ error: 'Erro ao ler arquivos.' });
    }
});

// Rota: Criar pasta
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

// Rota: Upload de Chunks
app.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
    try {
        const { chunkIndex, totalChunks, fileName, folder, fileSize } = req.body;
        const index = parseInt(chunkIndex);
        const total = parseInt(totalChunks);
        const totalSize = parseInt(fileSize);

        // Validação de Tamanho e Tipo (Apenas no primeiro chunk para economizar CPU)
        if (index === 0) {
            if (totalSize > MAX_FILE_SIZE) {
                fs.unlinkSync(req.file.path);
                return res.status(413).json({ error: 'Arquivo excede o tamanho máximo permitido.' });
            }
            const ext = fileName.split('.').pop().toLowerCase();
            if (ALLOWED_EXTS.length > 0 && !ALLOWED_EXTS.includes(ext)) {
                fs.unlinkSync(req.file.path);
                return res.status(415).json({ error: `Tipo de arquivo não permitido: .${ext}` });
            }
        }

        const safeFolder = getSafeFolderPath(folder);
        if (!safeFolder.startsWith(baseUploadDir)) throw new Error('Tentativa de Directory Traversal.');

        const partPath = path.join(tempDir, `${fileName}.part_${index}`);
        fs.renameSync(req.file.path, partPath);

        // Concatenação no último chunk
        if (index === total - 1) {
            if (!fs.existsSync(safeFolder)) fs.mkdirSync(safeFolder, { recursive: true });
            
            const finalFilePath = path.join(safeFolder, fileName);
            const writeStream = fs.createWriteStream(finalFilePath);

            for (let i = 0; i < total; i++) {
                const currentPart = path.join(tempDir, `${fileName}.part_${i}`);
                if (!fs.existsSync(currentPart)) throw new Error(`Chunk ${i} faltando.`);
                
                const data = await fs.promises.readFile(currentPart);
                writeStream.write(data);
                await fs.promises.unlink(currentPart);
            }
            writeStream.end();
            return res.status(200).json({ message: 'Upload completo!' });
        }

        res.status(200).json({ message: `Chunk ${index} recebido.` });
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('Erro no upload:', error.message);
        res.status(500).json({ error: error.message || 'Erro interno no processamento do chunk.' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});