**Local Drop Organizador**

Projeto simples para receber uploads grandes (divididos em chunks), organizar arquivos por pastas no servidor e fornecer uma interface web leve para gerenciar envios.

**Visão Geral**:
- **Projeto:** Servidor Node/Express com frontend estático em [public/index.html](public/index.html)
- **Entrada:** [src/server.js](src/server.js)
- **Scripts:** [package.json](package.json)

**Funcionalidades Principais**:
- Upload de arquivos em chunks (permite arquivos grandes)
- Criação de pastas no servidor via API
- Listagem de pastas e arquivos
- Limpeza automática de chunks temporários órfãos

**Requisitos**:
- Node.js 16+ (ou versão compatível com dependências)
- npm

**Instalação**
1. Clone o repositório.
2. Instale dependências:

```bash
npm install
```

**Variáveis de Ambiente**
Crie um arquivo `.env` na raiz (opcional). Variáveis suportadas:

- `PORT` — Porta do servidor (padrão `3000`).
- `UPLOAD_DIR` — Pasta onde os uploads finais serão armazenados (padrão `uploads`).
- `TEMP_DIR` — Pasta temporária para chunks (padrão `temp`).
- `MAX_FILE_SIZE_MB` — Tamanho máximo do arquivo em MB (padrão `5000`).
- `ALLOWED_EXTENSIONS` — Extensões permitidas, separadas por vírgula (ex: `jpg,png,mp4`).

Exemplo de `.env`:

```text
PORT=3000
UPLOAD_DIR=uploads
TEMP_DIR=temp
MAX_FILE_SIZE_MB=5000
ALLOWED_EXTENSIONS=jpg,png,mp4,jpeg,gif
```

**Como Rodar**

```bash
# Modo desenvolvimento (recarrega com nodemon)
npm run dev

# Modo produção
npm start
```

Depois de iniciar, abra `http://localhost:PORT/` (por exemplo `http://localhost:3000/`) para acessar a interface web.

**Uso (interface web)**
- 1) Escolha ou crie uma pasta (menu suspenso ou crie novo nome de pasta).
- 2) Selecione um ou mais arquivos no campo de seleção.
- 3) Clique em "Iniciar Upload" — o frontend envia os arquivos em pedaços (chunks) ao servidor.
- 4) A interface atualiza a lista de arquivos na pasta selecionada.

**APIs Principais**
- `GET /folders` — Retorna lista de pastas (JSON).
- `GET /files?folder=<nome>` — Retorna lista de arquivos na pasta (JSON).
- `POST /folders` — Cria uma nova pasta. Corpo JSON: `{ "folderName": "nome" }`.
- `POST /upload-chunk` — Endpoint para upload de chunks. Deve receber `multipart/form-data` com os campos:
  - `chunk` (arquivo), `chunkIndex`, `totalChunks`, `fileName`, `folder`, `fileSize`.

**Como Funciona (técnico)**

- O frontend divide cada arquivo em chunks de aproximadamente 5 MB (variável `CHUNK_SIZE`).
- Para cada chunk é feito um `POST /upload-chunk` com o pedaço e metadados.
- No servidor (`src/server.js`):
  - Os chunks chegam e são salvos temporariamente em `TEMP_DIR` como `fileName.part_<index>`.
  - No recebimento do primeiro chunk, o servidor valida tamanho total (`MAX_FILE_SIZE_MB`) e, se configurado, a extensão do arquivo (`ALLOWED_EXTENSIONS`).
  - Quando o último chunk chega (`chunkIndex === totalChunks - 1`), o servidor concatena todos os arquivos temporários ordenados (0..total-1) em um arquivo final dentro de `UPLOAD_DIR/<folder>` e remove os `.part_*` temporários.
  - Existe uma rotina de limpeza que remove arquivos temporários com mais de 2 horas (evita acumular chunks órfãos).

**Segurança e Validações**
- Validação de nome de pasta via regex (somente letras, números, espaços, hífens e underlines).
- `getSafeFolderPath` usa `path.basename` e verifica que o caminho final começa com `UPLOAD_DIR` para prevenir directory traversal.
- Validação de tamanho e extensão é feita no primeiro chunk para minimizar uso de CPU.

**Estrutura de Arquivos**
- `package.json` — Configuração e scripts ([package.json](package.json)).
- `src/server.js` — Lógica do servidor e endpoints ([src/server.js](src/server.js)).
- `public/index.html` — Interface web e scripts frontend ([public/index.html](public/index.html)).
- `uploads/` — Pasta onde arquivos finais são armazenados (gerada automaticamente).
- `temp/` — Pasta onde chunks são salvos temporariamente (gerada automaticamente).

**Melhorias e Sugestões**
- Adicionar autenticação/controle de acesso (ex: token ou OAuth) para proteger endpoints.
- Implementar verificação de soma de verificação (hash) para garantir integridade de arquivos.
- Suporte a limpeza configurável e monitoramento (ex: job scheduler, logs rotativos).
- Adicionar paginação e ordenação na listagem de arquivos.

**Contribuição**
- Abra issues para bugs ou solicitações.
- Para contribuições: faça fork, crie branch, abra PR com descrição clara.

**Licença**
- Projeto usa licença definida em [package.json](package.json) (ISC por padrão).


