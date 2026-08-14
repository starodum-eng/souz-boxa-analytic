/**
 * Мини-парсер CSV без зависимостей.
 * Поддерживает: кавычки, экранированные кавычки (""), переводы строк внутри
 * поля, автоопределение разделителя (; или ,), BOM.
 */
export function parseCsv(input: string): string[][] {
  // срезаем BOM
  const text = input.replace(/^﻿/, "");

  // автоопределение разделителя по первой строке
  const firstLine = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length);
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // экранированная кавычка
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      // игнорируем — обработаем на \n
    } else {
      field += ch;
    }
  }
  // хвост
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
