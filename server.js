const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SIGO_URL = process.env.SIGO_URL || 'https://sigoobras2.mocha.app';
const DEBUG = process.env.DEBUG === 'true';

// Mensagens personalizáveis
const WELCOME_MESSAGE = process.env.WELCOME_MESSAGE || 
  'Olá! Envie fotos ou PDFs de notas fiscais e elas serão processadas automaticamente no SIGO Obras.';
const SUCCESS_MESSAGE = process.env.SUCCESS_MESSAGE || 
  '✅ Documento recebido com sucesso! Acesse o SIGO Obras para revisar e aprovar.';
const ERROR_MESSAGE = process.env.ERROR_MESSAGE || 
  '❌ Erro ao processar documento. Verifique se seu telefone está cadastrado no sistema.';

// Inicializar cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

// Estado do bot
let botStatus = {
  connected: false,
  qrCode: null,
  lastMessage: null,
  messagesProcessed: 0,
  errors: 0
};

// Gerar QR Code
client.on('qr', (qr) => {
  console.log('\n==============================================');
  console.log('📱 ESCANEIE O QR CODE ABAIXO COM SEU WHATSAPP');
  console.log('==============================================\n');
  qrcode.generate(qr, { small: true });
  console.log('\n==============================================');
  console.log('Aguardando conexão...');
  console.log('==============================================\n');
  botStatus.qrCode = qr;
  botStatus.connected = false;
});

// Cliente pronto
client.on('ready', () => {
  console.log('\n✅ Bot WhatsApp conectado e pronto!');
  console.log(`🔗 Enviando documentos para: ${SIGO_URL}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}\n`);
  botStatus.connected = true;
  botStatus.qrCode = null;
});

// Desconectado
client.on('disconnected', (reason) => {
  console.log('❌ Bot desconectado:', reason);
  botStatus.connected = false;
});

// Função para normalizar telefone
function normalizarTelefone(telefone) {
  // Extrair apenas números
  let digits = telefone.replace(/\D/g, '');
  
  // Remover código do país (55) se presente
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }
  
  // Remover 9 extra do celular se presente (formato antigo)
  if (digits.length === 11 && digits[2] === '9') {
    // Manter como está - formato correto
  }
  
  return digits;
}

// Função para extrair texto simples da imagem (OCR básico com GPT-4 Vision pode ser adicionado)
async function extrairTextoBasico(message) {
  try {
    // Por enquanto, retornar informações básicas da mensagem
    const info = {
      tipo: message.type,
      timestamp: new Date(message.timestamp * 1000).toISOString(),
      de: message.from,
      corpo: message.body || ''
    };
    
    return `Documento recebido via WhatsApp\nTipo: ${info.tipo}\nData: ${info.timestamp}\nObs: ${info.corpo}`;
  } catch (error) {
    console.error('Erro ao extrair texto:', error);
    return 'Documento enviado via WhatsApp';
  }
}

// Processar mensagem com mídia
async function processarDocumento(message) {
  try {
    console.log('\n📄 Processando novo documento...');
    
    // Obter mídia
    const media = await message.downloadMedia();
    
    if (!media) {
      console.log('❌ Não foi possível baixar a mídia');
      await message.reply('❌ Não consegui baixar o documento. Tente enviar novamente.');
      return;
    }
    
    console.log(`📎 Mídia baixada: ${media.mimetype}`);
    
    // Extrair telefone do remetente
    const telefoneCompleto = message.from; // Formato: 5511987654321@c.us
    const telefone = normalizarTelefone(telefoneCompleto);
    
    console.log(`📱 Telefone do remetente: ${telefone}`);
    
    // Converter mídia para URL base64 (temporário)
    const arquivo_url = `data:${media.mimetype};base64,${media.data}`;
    
    // Extrair texto básico
    const texto_ocr = await extrairTextoBasico(message);
    
    // Preparar dados para enviar ao SIGO
    const dados = {
      telefone: telefone,
      arquivo_url: arquivo_url,
      descricao: message.body || 'Documento enviado via WhatsApp',
      texto_ocr: texto_ocr,
      data: new Date().toISOString()
    };
    
    if (DEBUG) {
      console.log('📤 Enviando para SIGO:', {
        ...dados,
        arquivo_url: `${arquivo_url.substring(0, 50)}... (${arquivo_url.length} bytes)`
      });
    }
    
    // Enviar para SIGO Obras
    console.log(`🚀 Enviando para ${SIGO_URL}/api/ocr-receber-arquivo`);
    
    const response = await axios.post(
      `${SIGO_URL}/api/ocr-receber-arquivo`,
      dados,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 segundos
      }
    );
    
    console.log('✅ Resposta do SIGO:', response.data);
    
    // Enviar confirmação ao usuário
    if (response.data.ok) {
      await message.reply(SUCCESS_MESSAGE);
      botStatus.messagesProcessed++;
      console.log(`✅ Documento processado com sucesso! (Total: ${botStatus.messagesProcessed})`);
    } else {
      await message.reply(`${ERROR_MESSAGE}\n\nDetalhes: ${response.data.error}`);
      botStatus.errors++;
      console.log('⚠️  Resposta não-OK do SIGO:', response.data);
    }
    
  } catch (error) {
    console.error('❌ Erro ao processar documento:', error.message);
    
    if (error.response) {
      console.error('Resposta do servidor:', error.response.data);
      
      // Mensagem de erro personalizada baseada na resposta
      let errorMsg = ERROR_MESSAGE;
      if (error.response.data?.details) {
        errorMsg += `\n\n${error.response.data.details}`;
      }
      await message.reply(errorMsg);
    } else {
      await message.reply(`${ERROR_MESSAGE}\n\nErro: ${error.message}`);
    }
    
    botStatus.errors++;
  }
}

// Receber mensagens
client.on('message', async (message) => {
  try {
    botStatus.lastMessage = new Date().toISOString();
    
    // Ignorar mensagens de grupo
    const chat = await message.getChat();
    if (chat.isGroup) {
      if (DEBUG) console.log('⏭️  Ignorando mensagem de grupo');
      return;
    }
    
    // Verificar se tem mídia (imagem ou documento)
    if (message.hasMedia) {
      const mediaType = message.type;
      
      if (DEBUG) {
        console.log(`\n📨 Nova mensagem com mídia: ${mediaType}`);
        console.log(`De: ${message.from}`);
        console.log(`Corpo: ${message.body || '(sem texto)'}`);
      }
      
      // Processar apenas imagens e documentos
      if (mediaType === 'image' || mediaType === 'document') {
        await processarDocumento(message);
      } else {
        if (DEBUG) console.log(`⏭️  Tipo de mídia não suportado: ${mediaType}`);
      }
    } else {
      // Mensagem sem mídia - enviar instruções
      if (message.body.toLowerCase().includes('ajuda') || 
          message.body.toLowerCase().includes('help') ||
          message.body.toLowerCase().includes('oi') ||
          message.body.toLowerCase().includes('olá')) {
        await message.reply(WELCOME_MESSAGE);
      }
    }
  } catch (error) {
    console.error('❌ Erro ao processar mensagem:', error);
    botStatus.errors++;
  }
});

// Dashboard web simples
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bot WhatsApp SIGO Obras</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          max-width: 600px;
          width: 100%;
          padding: 40px;
        }
        h1 {
          color: #333;
          margin-bottom: 10px;
          font-size: 28px;
        }
        .subtitle {
          color: #666;
          margin-bottom: 30px;
          font-size: 14px;
        }
        .status {
          padding: 15px;
          border-radius: 10px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 500;
        }
        .status.connected {
          background: #d4edda;
          color: #155724;
        }
        .status.disconnected {
          background: #f8d7da;
          color: #721c24;
        }
        .status-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }
        .status.connected .status-dot {
          background: #28a745;
          animation: pulse 2s infinite;
        }
        .status.disconnected .status-dot {
          background: #dc3545;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 15px;
          margin-bottom: 30px;
        }
        .stat-card {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 10px;
          text-align: center;
        }
        .stat-value {
          font-size: 32px;
          font-weight: bold;
          color: #667eea;
          margin-bottom: 5px;
        }
        .stat-label {
          font-size: 12px;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .info {
          background: #e7f3ff;
          border-left: 4px solid #2196F3;
          padding: 15px;
          border-radius: 5px;
          margin-bottom: 20px;
        }
        .info-title {
          font-weight: bold;
          color: #1976D2;
          margin-bottom: 8px;
        }
        .info-text {
          color: #555;
          font-size: 14px;
          line-height: 1.6;
        }
        .btn {
          background: #667eea;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          width: 100%;
          margin-top: 10px;
        }
        .btn:hover {
          background: #5568d3;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        .qr-container {
          text-align: center;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 10px;
          margin: 20px 0;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #eee;
          color: #999;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Bot WhatsApp SIGO Obras</h1>
        <p class="subtitle">Recebimento automático de documentos financeiros</p>
        
        <div class="status ${botStatus.connected ? 'connected' : 'disconnected'}">
          <div class="status-dot"></div>
          <span>${botStatus.connected ? '✅ Conectado e funcionando' : '⚠️ Aguardando conexão'}</span>
        </div>
        
        <div class="stats">
          <div class="stat-card">
            <div class="stat-value">${botStatus.messagesProcessed}</div>
            <div class="stat-label">Documentos</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${botStatus.errors}</div>
            <div class="stat-label">Erros</div>
          </div>
        </div>
        
        ${!botStatus.connected ? `
          <div class="qr-container">
            <p style="margin-bottom: 15px; color: #666;">
              <strong>Primeiro acesso?</strong><br>
              Escaneie o QR Code no terminal onde o bot está rodando
            </p>
            <p style="font-size: 12px; color: #999;">
              Após escanear, esta página será atualizada automaticamente
            </p>
          </div>
        ` : `
          <div class="info">
            <div class="info-title">✅ Bot ativo e pronto!</div>
            <div class="info-text">
              O bot está conectado e processando documentos automaticamente.<br>
              Envie fotos ou PDFs de notas fiscais para o WhatsApp conectado.
            </div>
          </div>
        `}
        
        <div class="info">
          <div class="info-title">📍 Servidor SIGO</div>
          <div class="info-text">
            <code style="background: #fff; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
              ${SIGO_URL}
            </code>
          </div>
        </div>
        
        ${botStatus.lastMessage ? `
          <div class="info">
            <div class="info-title">🕐 Última mensagem</div>
            <div class="info-text">
              ${new Date(botStatus.lastMessage).toLocaleString('pt-BR')}
            </div>
          </div>
        ` : ''}
        
        <button class="btn" onclick="location.reload()">🔄 Atualizar Status</button>
        
        <div class="footer">
          Bot desenvolvido para SIGO Obras<br>
          Integração WhatsApp → SIGO
        </div>
      </div>
      
      <script>
        // Auto-refresh a cada 10 segundos
        setTimeout(() => location.reload(), 10000);
      </script>
    </body>
    </html>
  `);
});

// Status API
app.get('/api/status', (req, res) => {
  res.json(botStatus);
});

// Iniciar servidor web
app.listen(PORT, () => {
  console.log(`\n🌐 Dashboard disponível em: http://localhost:${PORT}`);
});

// Inicializar bot
console.log('\n🚀 Iniciando Bot WhatsApp SIGO Obras...\n');
client.initialize();

// Tratamento de erros
process.on('unhandledRejection', (error) => {
  console.error('❌ Erro não tratado:', error);
});

process.on('SIGINT', async () => {
  console.log('\n\n👋 Encerrando bot...');
  await client.destroy();
  process.exit(0);
});
