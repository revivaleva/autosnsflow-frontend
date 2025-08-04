/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "../API";
type GeneratedSubscription<InputType, OutputType> = string & {
  __generatedSubscriptionInput: InputType;
  __generatedSubscriptionOutput: OutputType;
};

export const onCreateLoginForm = /* GraphQL */ `subscription OnCreateLoginForm($filter: ModelSubscriptionLoginFormFilterInput) {
  onCreateLoginForm(filter: $filter) {
    id
    username
    password
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnCreateLoginFormSubscriptionVariables,
  APITypes.OnCreateLoginFormSubscription
>;
export const onUpdateLoginForm = /* GraphQL */ `subscription OnUpdateLoginForm($filter: ModelSubscriptionLoginFormFilterInput) {
  onUpdateLoginForm(filter: $filter) {
    id
    username
    password
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnUpdateLoginFormSubscriptionVariables,
  APITypes.OnUpdateLoginFormSubscription
>;
export const onDeleteLoginForm = /* GraphQL */ `subscription OnDeleteLoginForm($filter: ModelSubscriptionLoginFormFilterInput) {
  onDeleteLoginForm(filter: $filter) {
    id
    username
    password
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnDeleteLoginFormSubscriptionVariables,
  APITypes.OnDeleteLoginFormSubscription
>;
export const onCreateSNSAccount = /* GraphQL */ `subscription OnCreateSNSAccount(
  $filter: ModelSubscriptionSNSAccountFilterInput
  $owner: String
) {
  onCreateSNSAccount(filter: $filter, owner: $owner) {
    id
    platform
    displayName
    accountId
    createdAt
    autoPost
    autoGenerate
    autoReply
    updatedAt
    owner
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnCreateSNSAccountSubscriptionVariables,
  APITypes.OnCreateSNSAccountSubscription
>;
export const onUpdateSNSAccount = /* GraphQL */ `subscription OnUpdateSNSAccount(
  $filter: ModelSubscriptionSNSAccountFilterInput
  $owner: String
) {
  onUpdateSNSAccount(filter: $filter, owner: $owner) {
    id
    platform
    displayName
    accountId
    createdAt
    autoPost
    autoGenerate
    autoReply
    updatedAt
    owner
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnUpdateSNSAccountSubscriptionVariables,
  APITypes.OnUpdateSNSAccountSubscription
>;
export const onDeleteSNSAccount = /* GraphQL */ `subscription OnDeleteSNSAccount(
  $filter: ModelSubscriptionSNSAccountFilterInput
  $owner: String
) {
  onDeleteSNSAccount(filter: $filter, owner: $owner) {
    id
    platform
    displayName
    accountId
    createdAt
    autoPost
    autoGenerate
    autoReply
    updatedAt
    owner
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnDeleteSNSAccountSubscriptionVariables,
  APITypes.OnDeleteSNSAccountSubscription
>;
