// import * as wmill from "windmill-client"

type Item = {
  table_id: number;
  id: number;
  URL: string;
};

// Function to update an item in the database
export const saveToBaserow = async (item: Item) => {
  const url = `http://baserow/api/database/rows/table/${item.table_id}/${item.id}/?user_field_names=true`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: 'Token w8zxSIODyCfJXUFvhMubk5YcbTCRRqXq',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      //      name: item.name,
      URL: item.URL,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update item with id ${item.id}: ${response.statusText}`);
  }

  const result = await response.json();
  console.log('Update result:', result);

  return result;
};
