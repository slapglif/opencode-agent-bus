/**
 * TOON (Token-Oriented Object Notation) Formatter
 * Reduces token usage by 18-40% vs JSON for array-heavy data
 * 
 * Format:
 * collection_name[count]{field1,field2,...}:
 *   value1,value2,...
 *   value1,value2,...
 */

export interface ToonOptions {
  indent?: string;
  includeHeader?: boolean;
}

/**
 * Convert array of objects to TOON format
 */
export function arrayToToon(
  collectionName: string,
  data: Record<string, any>[],
  options: ToonOptions = {}
): string {
  const {indent = '  ', includeHeader = true} = options;
  
  if (!Array.isArray(data) || data.length === 0) {
    return `${collectionName}[0]{}: (empty)`;
  }

  // Extract field names from first object
  const fields = Object.keys(data[0]);
  
  // Build header
  const header = includeHeader
    ? `${collectionName}[${data.length}]{${fields.join(',')}}:`
    : '';

  // Build rows
  const rows = data.map(obj => {
    const values = fields.map(field => {
      const value = obj[field];
      // Escape commas in values
      if (value === null || value === undefined) return '';
      const stringValue = String(value);
      return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
    });
    return `${indent}${values.join(',')}`;
  });

  return includeHeader ? `${header}\n${rows.join('\n')}` : rows.join('\n');
}

/**
 * Convert generic object to TOON format
 */
export function objectToToon(data: Record<string, any>): string {
  const entries = Object.entries(data);
  
  if (entries.length === 0) return '{}';

  // Check if all values are arrays of objects
  const arrayEntries = entries.filter(([_, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object');
  
  if (arrayEntries.length > 0) {
    // Format as multiple TOON collections
    return arrayEntries
      .map(([key, value]) => arrayToToon(key, value as Record<string, any>[]))
      .join('\n\n');
  }

  // Fallback to simple key: value format
  return entries
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
}

/**
 * Calculate token savings (estimated)
 * Using approximate GPT-4 tokenization: 4 chars ≈ 1 token
 */
export function estimateTokenSavings(jsonStr: string, toonStr: string): {
  jsonChars: number;
  toonChars: number;
  savedChars: number;
  savedPercentage: number;
  estimatedJsonTokens: number;
  estimatedToonTokens: number;
  estimatedSavedTokens: number;
} {
  const jsonChars = jsonStr.length;
  const toonChars = toonStr.length;
  const savedChars = jsonChars - toonChars;
  const savedPercentage = ((savedChars / jsonChars) * 100).toFixed(1);
  
  // Rough estimation: 4 chars ≈ 1 token for GPT-4
  const estimatedJsonTokens = Math.ceil(jsonChars / 4);
  const estimatedToonTokens = Math.ceil(toonChars / 4);
  const estimatedSavedTokens = estimatedJsonTokens - estimatedToonTokens;

  return {
    jsonChars,
    toonChars,
    savedChars,
    savedPercentage: parseFloat(savedPercentage),
    estimatedJsonTokens,
    estimatedToonTokens,
    estimatedSavedTokens
  };
}

/**
 * Format MCP response in TOON format
 */
export function formatMcpResponse(response: any): string {
  if (response.messages && Array.isArray(response.messages)) {
    return arrayToToon('messages', response.messages);
  }
  
  if (response.agents && Array.isArray(response.agents)) {
    return arrayToToon('agents', response.agents);
  }
  
  if (response.responses && Array.isArray(response.responses)) {
    return arrayToToon('responses', response.responses);
  }
  
  if (response.servers && Array.isArray(response.servers)) {
    return arrayToToon('servers', response.servers);
  }
  
  // Generic object handling
  return objectToToon(response);
}
