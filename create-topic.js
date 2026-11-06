/* eslint-disable @typescript-eslint/no-require-imports -- standalone Node script */
require("dotenv").config({ path: ".env.local" });

const {
  Client,
  PrivateKey,
  TopicCreateTransaction
} = require("@hashgraph/sdk");

async function createTopic() {
  const client = Client.forTestnet();

const operatorKey = PrivateKey.fromStringECDSA(
  process.env.HEDERA_OPERATOR_KEY.replace(/^0x/, "")
);

client.setOperator(
  process.env.HEDERA_OPERATOR_ID,
  operatorKey
);

  const transaction = await new TopicCreateTransaction()
    .setTopicMemo("PayGate Agent Payment Audit Log")
    .execute(client);

  const receipt = await transaction.getReceipt(client);

  console.log("HCS Topic ID:", receipt.topicId.toString());

  client.close();
}

createTopic().catch(console.error);
