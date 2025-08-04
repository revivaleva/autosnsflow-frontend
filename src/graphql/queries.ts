/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "../API";
type GeneratedQuery<InputType, OutputType> = string & {
  __generatedQueryInput: InputType;
  __generatedQueryOutput: OutputType;
};

export const getLoginForm = /* GraphQL */ `query GetLoginForm($id: ID!) {
  getLoginForm(id: $id) {
    id
    username
    password
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetLoginFormQueryVariables,
  APITypes.GetLoginFormQuery
>;
export const listLoginForms = /* GraphQL */ `query ListLoginForms(
  $filter: ModelLoginFormFilterInput
  $limit: Int
  $nextToken: String
) {
  listLoginForms(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      id
      username
      password
      createdAt
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListLoginFormsQueryVariables,
  APITypes.ListLoginFormsQuery
>;
export const getSNSAccount = /* GraphQL */ `query GetSNSAccount($id: ID!) {
  getSNSAccount(id: $id) {
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
` as GeneratedQuery<
  APITypes.GetSNSAccountQueryVariables,
  APITypes.GetSNSAccountQuery
>;
export const listSNSAccounts = /* GraphQL */ `query ListSNSAccounts(
  $filter: ModelSNSAccountFilterInput
  $limit: Int
  $nextToken: String
) {
  listSNSAccounts(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
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
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListSNSAccountsQueryVariables,
  APITypes.ListSNSAccountsQuery
>;
