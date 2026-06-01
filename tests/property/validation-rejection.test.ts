import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { Database } from '../../src/db/database.js';
import { NodeRepository } from '../../src/db/repositories/node-repository.js';
import { NamespaceRepository } from '../../src/db/repositories/namespace-repository.js';
import type { CreateNodeRequest } from '../../src/types/api.js';
import type { OpcUaDataType } from '../../src/types/index.js';

/**
 * Feature: opcua-light-server
 * Property 5: Validation Rejects Invalid Input with Descriptive Errors
 *
 * Validates: Requirements 1.5
 */

const SUPPORTED_DATA_TYPES: OpcUaDataType[] = [
  'Boolean',
  'Int16',
  'Int32',
  'Int64',
  'UInt16',
  'UInt32',
  'UInt64',
  'Float',
  'Double',
  'String',
  'DateTime',
  'ByteString',
];

describe('Feature: opcua-light-server, Property 5: Validation Rejects Invalid Input with Descriptive Errors', () => {
  let database: Database;
  let nodeRepository: NodeRepository;
  let namespaceRepository: NamespaceRepository;
  let testNamespaceId: string;

  beforeEach(() => {
    database = new Database(':memory:');
    nodeRepository = new NodeRepository(database);
    namespaceRepository = new NamespaceRepository(database);

    // Create a valid namespace for tests that need one
    const result = namespaceRepository.create({
      name: 'TestNamespace',
      uri: 'urn:opcua-light:test',
      description: 'Test namespace for property tests',
    });
    if (result.success) {
      testNamespaceId = result.data.id;
    }
  });

  afterEach(() => {
    database.close();
  });

  /**
   * Validates: Requirements 1.5
   *
   * For any node definition with at least one invalid field, the repository
   * SHALL reject the request and return an error that references the specific
   * invalid field.
   */
  it('should reject node definitions with empty name and reference the name field', () => {
    fc.assert(
      fc.property(
        fc.record({
          namespaceId: fc.constant(testNamespaceId),
          dataType: fc.constantFrom(...SUPPORTED_DATA_TYPES),
          description: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
        }),
        (params) => {
          const request: CreateNodeRequest = {
            name: '',
            namespaceId: params.namespaceId,
            dataType: params.dataType,
            description: params.description,
          };

          expect(() => nodeRepository.create(request)).toThrow();

          try {
            nodeRepository.create(request);
          } catch (error: any) {
            expect(error.validationErrors).toBeDefined();
            expect(Array.isArray(error.validationErrors)).toBe(true);
            const fieldNames = error.validationErrors.map((e: any) => e.field);
            expect(fieldNames).toContain('name');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject node definitions with empty namespaceId and reference the namespaceId field', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          dataType: fc.constantFrom(...SUPPORTED_DATA_TYPES),
          description: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
        }),
        (params) => {
          const request: CreateNodeRequest = {
            name: params.name,
            namespaceId: '',
            dataType: params.dataType,
            description: params.description,
          };

          expect(() => nodeRepository.create(request)).toThrow();

          try {
            nodeRepository.create(request);
          } catch (error: any) {
            expect(error.validationErrors).toBeDefined();
            expect(Array.isArray(error.validationErrors)).toBe(true);
            const fieldNames = error.validationErrors.map((e: any) => e.field);
            expect(fieldNames).toContain('namespaceId');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject node definitions with invalid/unsupported dataType and reference the dataType field', () => {
    const invalidDataTypes = fc.oneof(
      fc.constant('Complex128'),
      fc.constant('Blob'),
      fc.string({ minLength: 1, maxLength: 30 }).filter(
        (s) => !SUPPORTED_DATA_TYPES.includes(s as OpcUaDataType)
      )
    );

    fc.assert(
      fc.property(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          namespaceId: fc.constant(testNamespaceId),
          invalidDataType: invalidDataTypes,
          description: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
        }),
        (params) => {
          const request = {
            name: params.name,
            namespaceId: params.namespaceId,
            dataType: params.invalidDataType as OpcUaDataType,
            description: params.description,
          } as CreateNodeRequest;

          expect(() => nodeRepository.create(request)).toThrow();

          try {
            nodeRepository.create(request);
          } catch (error: any) {
            expect(error.validationErrors).toBeDefined();
            expect(Array.isArray(error.validationErrors)).toBe(true);
            const fieldNames = error.validationErrors.map((e: any) => e.field);
            expect(fieldNames).toContain('dataType');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
