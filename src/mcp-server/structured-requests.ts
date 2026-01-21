import type Database from 'better-sqlite3';
import { z } from 'zod';
import { MessageBus } from './bus.js';
import type { Message } from './database.js';
import { generateMessageId } from './database.js';

export interface StructuredRequest extends Message {
  response_schema: Record<string, unknown>;
  validation_mode: 'strict' | 'permissive';
  timeout_seconds: number;
}

export interface StructuredResponse {
  id: string;
  correlation_id: string;
  content: string;
  validated: boolean;
  validation_errors?: string[];
  sender_agent: string;
  sender_session: string;
  created_at: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

interface StructuredMessageContent {
  content: string;
  responseSchema: Record<string, unknown>;
  validationMode: 'strict' | 'permissive';
}

export class StructuredRequestManager {
  private db: Database.Database;
  private bus: MessageBus;

  constructor(db: Database.Database, bus: MessageBus) {
    this.db = db;
    this.bus = bus;
  }

  sendStructuredRequest(
    channel: string,
    senderAgent: string,
    senderSession: string,
    content: string,
    responseSchema: Record<string, unknown>,
    options: {
      validationMode?: 'strict' | 'permissive';
      timeout?: number;
    } = {}
  ): StructuredRequest {
    const validationMode = options.validationMode ?? 'strict';
    const timeout = options.timeout ?? 60;

    const structuredContent: StructuredMessageContent = {
      content,
      responseSchema,
      validationMode
    };

    const message = this.bus.sendRequest(
      channel,
      senderAgent,
      senderSession,
      JSON.stringify(structuredContent),
      timeout
    );

    return {
      ...message,
      response_schema: responseSchema,
      validation_mode: validationMode,
      timeout_seconds: timeout
    };
  }

  respondToStructuredRequest(
    correlationId: string,
    responderAgent: string,
    responderSession: string,
    content: string
  ): boolean {
    const requestStmt = this.db.prepare(`
      SELECT content FROM messages
      WHERE (id = ? OR correlation_id = ?) AND message_type = 'request'
      LIMIT 1
    `);
    const request = requestStmt.get(correlationId, correlationId) as { content: string } | undefined;

    if (!request) {
      throw new Error(`No structured request found with correlation ID: ${correlationId}`);
    }

    let structuredContent: StructuredMessageContent;
    try {
      structuredContent = JSON.parse(request.content) as StructuredMessageContent;
    } catch {
      throw new Error('Invalid structured request content format');
    }

    let parsedResponse: unknown;
    try {
      parsedResponse = JSON.parse(content);
    } catch {
      throw new Error('Response must be valid JSON');
    }

    const validation = this.validateResponse(parsedResponse, structuredContent.responseSchema);

    if (!validation.valid && structuredContent.validationMode === 'strict') {
      throw new Error(`Response validation failed: ${validation.errors?.join(', ')}`);
    }

    this.bus.sendResponse(correlationId, responderAgent, responderSession, content);

    return validation.valid;
  }

  getStructuredResponses(correlationId: string): StructuredResponse[] {
    const requestStmt = this.db.prepare(`
      SELECT content FROM messages
      WHERE (id = ? OR correlation_id = ?) AND message_type = 'request'
      LIMIT 1
    `);
    const request = requestStmt.get(correlationId, correlationId) as { content: string } | undefined;

    if (!request) {
      return [];
    }

    let structuredContent: StructuredMessageContent;
    try {
      structuredContent = JSON.parse(request.content) as StructuredMessageContent;
    } catch {
      return [];
    }

    const responses = this.bus.getResponses(correlationId);

    return responses.map(response => {
      let parsedResponse: unknown;
      let validated = false;
      let validationErrors: string[] | undefined;

      try {
        parsedResponse = JSON.parse(response.content);
        const validation = this.validateResponse(parsedResponse, structuredContent.responseSchema);
        validated = validation.valid;
        validationErrors = validation.errors;
      } catch (error) {
        validated = false;
        validationErrors = [error instanceof Error ? error.message : 'Invalid JSON'];
      }

      return {
        id: response.id,
        correlation_id: response.correlation_id ?? correlationId,
        content: response.content,
        validated,
        validation_errors: validationErrors,
        sender_agent: response.sender_agent,
        sender_session: response.sender_session,
        created_at: response.created_at
      };
    });
  }

  validateResponse(response: unknown, schema: Record<string, unknown>): ValidationResult {
    try {
      const zodSchema = this.jsonSchemaToZod(schema);
      zodSchema.parse(response);
      return { valid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          errors: error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
        };
      }
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Unknown validation error']
      };
    }
  }

  private jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
    const type = schema.type as string | undefined;

    if (type === 'object') {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = schema.required as string[] | undefined;

      if (!properties) {
        return z.object({});
      }

      const zodShape: Record<string, z.ZodType> = {};

      for (const [key, propSchema] of Object.entries(properties)) {
        const propZodSchema = this.jsonSchemaToZod(propSchema);
        zodShape[key] = required?.includes(key) ? propZodSchema : propZodSchema.optional();
      }

      return z.object(zodShape);
    }

    if (type === 'string') {
      return z.string();
    }

    if (type === 'number') {
      return z.number();
    }

    if (type === 'boolean') {
      return z.boolean();
    }

    if (type === 'array') {
      const items = schema.items as Record<string, unknown> | undefined;
      if (items) {
        return z.array(this.jsonSchemaToZod(items));
      }
      return z.array(z.unknown());
    }

    if (type === 'null') {
      return z.null();
    }

    return z.unknown();
  }
}
