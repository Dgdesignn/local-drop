// Adicione isso no seu arquivo JS para iniciar o upload automaticamente ao selecionar o arquivo
fileInput.addEventListener('change', async () => {
    const files = fileInput.files;
    if (files.length === 0) return;

    // Mostra o Toast flutuante
    document.getElementById('progressContainer').style.display = 'block';
    
    // Pega a pasta selecionada no combobox
    const selectedFolder = document.getElementById('folderSelect').value;

    for (let i = 0; i < files.length; i++) {
        document.getElementById('currentFileName').textContent = files[i].name;
        // Chamar sua função uploadFileInChunks(files[i], selectedFolder) aqui...
    }
});