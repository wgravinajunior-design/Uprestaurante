// Impressao de comandas em impressoras do Windows (spooler), sem dependencias externas.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

function listar() {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') return resolve([]);
        execFile('powershell.exe', [...PS, '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'],
            { windowsHide: true, timeout: 15000 }, (err, out) => {
                if (err) return resolve([]);
                try {
                    const j = JSON.parse(String(out).trim() || '[]');
                    resolve((Array.isArray(j) ? j : [j]).filter((n) => typeof n === 'string'));
                } catch (e) { resolve([]); }
            });
    });
}

// Envia texto simples para a impressora (nome vem por variavel de ambiente: sem injecao de comando)
function imprimir(impressora, texto) {
    return new Promise((resolve, reject) => {
        if (process.platform !== 'win32') return reject(new Error('Impressão disponível apenas no Windows'));
        const nome = String(impressora || '').trim();
        if (!nome) return reject(new Error('Impressora não informada'));
        const arq = path.join(os.tmpdir(), `dusuco_ticket_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`);
        fs.writeFileSync(arq, '﻿' + texto, 'utf8');
        execFile('powershell.exe',
            [...PS, 'Get-Content -LiteralPath $env:DUSUCO_FILE -Encoding UTF8 | Out-Printer -Name $env:DUSUCO_PRINTER'],
            { windowsHide: true, timeout: 20000, env: { ...process.env, DUSUCO_FILE: arq, DUSUCO_PRINTER: nome } },
            (err, _out, stderr) => {
                fs.rm(arq, { force: true }, () => {});
                if (err) return reject(new Error(String(stderr || err.message).trim().split('\n')[0]));
                resolve();
            });
    });
}

const LARGURA = 40;
const linha = (c = '-') => c.repeat(LARGURA);
const centro = (t) => ' '.repeat(Math.max(0, Math.floor((LARGURA - t.length) / 2))) + t;

function quebrar(texto, recuo = '') {
    const palavras = String(texto).split(/\s+/);
    const out = [];
    let atual = '';
    palavras.forEach((p) => {
        if ((atual + ' ' + p).trim().length > LARGURA - recuo.length) { out.push(recuo + atual.trim()); atual = p; }
        else atual = (atual + ' ' + p).trim();
    });
    if (atual) out.push(recuo + atual);
    return out;
}

// Monta a comanda de uma estacao
function montarComanda({ estacao, pedido, itens }) {
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const l = [];
    l.push(linha('='));
    l.push(centro(String(estacao || 'COZINHA').toUpperCase()));
    l.push(linha('='));
    l.push(`SENHA ${String(pedido.senha || '--').padStart(2, '0')}    Pedido ${pedido.id}    ${hora}`);
    const extra = [pedido.cliente && `Cliente: ${pedido.cliente}`, pedido.mesa && `Mesa: ${pedido.mesa}`, pedido.comanda && `Comanda: ${pedido.comanda}`].filter(Boolean);
    extra.forEach((e) => quebrar(e).forEach((x) => l.push(x)));
    l.push(linha());
    itens.forEach((i) => {
        const q = Number(i.quantidade);
        quebrar(`${Number.isInteger(q) ? q : q.toFixed(2)}x ${i.descricao}`).forEach((x) => l.push(x));
        if (i.observacao) quebrar(`obs: ${i.observacao}`, '   ').forEach((x) => l.push(x));
    });
    l.push(linha());
    l.push('', '', '');
    return l.join('\r\n');
}

module.exports = { listar, imprimir, montarComanda };
