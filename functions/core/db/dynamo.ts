import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';

// ─────────────────────────────────────────────────────────────
// CLIENT
// DynamoDB is outside the VPC — no credentials needed,
// Lambda IAM role handles access automatically.
// ─────────────────────────────────────────────────────────────

const base = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

const client = DynamoDBDocumentClient.from(base, {
  marshallOptions:   { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: false },
});

// ─────────────────────────────────────────────────────────────
// TABLE NAMES
// ─────────────────────────────────────────────────────────────

export const TABLES = {
  EXAM_SESSIONS:       'ExamSessions',
  FLASHCARD_PROGRESS:  'FlashcardProgress',
  USER_ACTIVITY:       'UserActivity',
  ONE_LINER_PROGRESS:  'OneLinerProgress',
} as const;

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

// Get a single item by primary key
export const dbGet = async <T>(
  table: string,
  key: Record<string, unknown>,
): Promise<T | null> => {
  const result = await client.send(new GetCommand({ TableName: table, Key: key }));
  return (result.Item as T) ?? null;
};

// Put a full item (creates or replaces)
export const dbPut = async (
  table: string,
  item: Record<string, unknown>,
): Promise<void> => {
  await client.send(new PutCommand({ TableName: table, Item: item }));
};

// Update specific fields on an existing item
export const dbUpdate = async (
  table: string,
  key: Record<string, unknown>,
  fields: Record<string, unknown>,
): Promise<void> => {
  const entries = Object.entries(fields);
  const expression = entries.map((_, i) => `#k${i} = :v${i}`).join(', ');
  const names: Record<string, string>  = {};
  const values: Record<string, unknown> = {};
  entries.forEach(([k, v], i) => {
    names[`#k${i}`]  = k;
    values[`:v${i}`] = v;
  });

  await client.send(new UpdateCommand({
    TableName:                 table,
    Key:                       key,
    UpdateExpression:          `SET ${expression}`,
    ExpressionAttributeNames:  names,
    ExpressionAttributeValues: values,
  }));
};

// Delete an item by primary key
export const dbDelete = async (
  table: string,
  key: Record<string, unknown>,
): Promise<void> => {
  await client.send(new DeleteCommand({ TableName: table, Key: key }));
};

// Query items by partition key — single page (use dbQueryAll for complete results)
export const dbQuery = async <T>(
  input: QueryCommandInput,
): Promise<T[]> => {
  const result = await client.send(new QueryCommand(input));
  return (result.Items as T[]) ?? [];
};

// Query ALL items for a partition key — paginates automatically through LastEvaluatedKey.
// Use this for deletions and exports where partial results are unacceptable.
export const dbQueryAll = async <T>(
  input: QueryCommandInput,
): Promise<T[]> => {
  const items: T[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await client.send(new QueryCommand({
      ...input,
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) items.push(...(result.Items as T[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
};
