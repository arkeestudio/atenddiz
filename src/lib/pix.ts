/**
 * Gerador de Payload PIX "Copia e Cola" (Padrão BR Code / EMVCo do Banco Central do Brasil)
 * 100% autônomo, sem dependências externas.
 */

function formatField(id: string, value: string): string {
  const len = value.length.toString().padStart(2, "0");
  return `${id}${len}${value}`;
}

function removeAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
}

/**
 * Cálculo do Checksum CRC16-CCITT (Polinômio 0x1021, valor inicial 0xFFFF)
 */
function crc16(str: string): string {
  let crc = 0xffff;
  const polynomial = 0x1021;

  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ polynomial) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export interface PixPayloadParams {
  chave: string;
  nome: string;
  cidade?: string;
  valor?: number | string | null;
  txid?: string;
  infoAdicional?: string;
}

export function generatePixCopyPaste(params: PixPayloadParams): string {
  const chave = params.chave.trim();
  if (!chave) return "";

  // 00: Payload Format Indicator
  let payload = formatField("00", "01");

  // 26: Merchant Account Information
  let mai = formatField("00", "br.gov.bcb.pix");
  mai += formatField("01", chave);
  if (params.infoAdicional) {
    mai += formatField("02", removeAccents(params.infoAdicional).slice(0, 50));
  }
  payload += formatField("26", mai);

  // 52: Merchant Category Code (0000 = padrão)
  payload += formatField("52", "0000");

  // 53: Transaction Currency (986 = Real Brasileiro / BRL)
  payload += formatField("53", "986");

  // 54: Transaction Amount (opcional, se informado formata com 2 casas)
  if (params.valor !== undefined && params.valor !== null && params.valor !== "") {
    const num = typeof params.valor === "number" ? params.valor : parseFloat(params.valor.toString().replace(",", "."));
    if (!isNaN(num) && num > 0) {
      payload += formatField("54", num.toFixed(2));
    }
  }

  // 58: Country Code (BR)
  payload += formatField("58", "BR");

  // 59: Merchant Name (máx 25 chars, sem acentos)
  const nomeLimpo = removeAccents(params.nome || "Empresa").slice(0, 25) || "EMPRESA";
  payload += formatField("59", nomeLimpo);

  // 60: Merchant City (máx 15 chars, sem acentos)
  const cidadeLimpa = removeAccents(params.cidade || "BRASIL").slice(0, 15) || "BRASIL";
  payload += formatField("60", cidadeLimpa);

  // 62: Additional Data Field (TXID)
  const rawTxid = (params.txid || "***").replace(/[^a-zA-Z0-9]/g, "").slice(0, 25) || "***";
  const adf = formatField("05", rawTxid);
  payload += formatField("62", adf);

  // 63: CRC16 (Calculado sobre o payload + "6304")
  const preCrc = `${payload}6304`;
  const checksum = crc16(preCrc);

  return `${preCrc}${checksum}`;
}
