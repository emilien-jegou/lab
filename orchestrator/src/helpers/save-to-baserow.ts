export const saveToBaserow = async (
  table_id: string | number,
  item_id: string | number,
  body: any,
) => {
  const url = `http://baserow/api/database/rows/table/${table_id}/${item_id}/?user_field_names=true`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: 'Token w8zxSIODyCfJXUFvhMubk5YcbTCRRqXq',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to update item with id ${item_id} on table ${table_id}: ${response.statusText}`,
    );
  }

  const result = await response.json();
  return result;
};
