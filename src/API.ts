/* tslint:disable */
/* eslint-disable */
//  This file was automatically generated and should not be edited.

export type CreateLoginFormInput = {
  id?: string | null,
  username?: string | null,
  password?: string | null,
};

export type ModelLoginFormConditionInput = {
  username?: ModelStringInput | null,
  password?: ModelStringInput | null,
  and?: Array< ModelLoginFormConditionInput | null > | null,
  or?: Array< ModelLoginFormConditionInput | null > | null,
  not?: ModelLoginFormConditionInput | null,
  createdAt?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelStringInput = {
  ne?: string | null,
  eq?: string | null,
  le?: string | null,
  lt?: string | null,
  ge?: string | null,
  gt?: string | null,
  contains?: string | null,
  notContains?: string | null,
  between?: Array< string | null > | null,
  beginsWith?: string | null,
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
  size?: ModelSizeInput | null,
};

export enum ModelAttributeTypes {
  binary = "binary",
  binarySet = "binarySet",
  bool = "bool",
  list = "list",
  map = "map",
  number = "number",
  numberSet = "numberSet",
  string = "string",
  stringSet = "stringSet",
  _null = "_null",
}


export type ModelSizeInput = {
  ne?: number | null,
  eq?: number | null,
  le?: number | null,
  lt?: number | null,
  ge?: number | null,
  gt?: number | null,
  between?: Array< number | null > | null,
};

export type LoginForm = {
  __typename: "LoginForm",
  id: string,
  username?: string | null,
  password?: string | null,
  createdAt: string,
  updatedAt: string,
};

export type UpdateLoginFormInput = {
  id: string,
  username?: string | null,
  password?: string | null,
};

export type DeleteLoginFormInput = {
  id: string,
};

export type CreateSNSAccountInput = {
  id?: string | null,
  platform: string,
  displayName: string,
  accountId: string,
  createdAt?: string | null,
  autoPost: boolean,
  autoGenerate: boolean,
  autoReply: boolean,
};

export type ModelSNSAccountConditionInput = {
  platform?: ModelStringInput | null,
  displayName?: ModelStringInput | null,
  accountId?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  autoPost?: ModelBooleanInput | null,
  autoGenerate?: ModelBooleanInput | null,
  autoReply?: ModelBooleanInput | null,
  and?: Array< ModelSNSAccountConditionInput | null > | null,
  or?: Array< ModelSNSAccountConditionInput | null > | null,
  not?: ModelSNSAccountConditionInput | null,
  updatedAt?: ModelStringInput | null,
  owner?: ModelStringInput | null,
};

export type ModelBooleanInput = {
  ne?: boolean | null,
  eq?: boolean | null,
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
};

export type SNSAccount = {
  __typename: "SNSAccount",
  id: string,
  platform: string,
  displayName: string,
  accountId: string,
  createdAt: string,
  autoPost: boolean,
  autoGenerate: boolean,
  autoReply: boolean,
  updatedAt: string,
  owner?: string | null,
};

export type UpdateSNSAccountInput = {
  id: string,
  platform?: string | null,
  displayName?: string | null,
  accountId?: string | null,
  createdAt?: string | null,
  autoPost?: boolean | null,
  autoGenerate?: boolean | null,
  autoReply?: boolean | null,
};

export type DeleteSNSAccountInput = {
  id: string,
};

export type ModelLoginFormFilterInput = {
  id?: ModelIDInput | null,
  username?: ModelStringInput | null,
  password?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
  and?: Array< ModelLoginFormFilterInput | null > | null,
  or?: Array< ModelLoginFormFilterInput | null > | null,
  not?: ModelLoginFormFilterInput | null,
};

export type ModelIDInput = {
  ne?: string | null,
  eq?: string | null,
  le?: string | null,
  lt?: string | null,
  ge?: string | null,
  gt?: string | null,
  contains?: string | null,
  notContains?: string | null,
  between?: Array< string | null > | null,
  beginsWith?: string | null,
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
  size?: ModelSizeInput | null,
};

export type ModelLoginFormConnection = {
  __typename: "ModelLoginFormConnection",
  items:  Array<LoginForm | null >,
  nextToken?: string | null,
};

export type ModelSNSAccountFilterInput = {
  id?: ModelIDInput | null,
  platform?: ModelStringInput | null,
  displayName?: ModelStringInput | null,
  accountId?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  autoPost?: ModelBooleanInput | null,
  autoGenerate?: ModelBooleanInput | null,
  autoReply?: ModelBooleanInput | null,
  updatedAt?: ModelStringInput | null,
  and?: Array< ModelSNSAccountFilterInput | null > | null,
  or?: Array< ModelSNSAccountFilterInput | null > | null,
  not?: ModelSNSAccountFilterInput | null,
  owner?: ModelStringInput | null,
};

export type ModelSNSAccountConnection = {
  __typename: "ModelSNSAccountConnection",
  items:  Array<SNSAccount | null >,
  nextToken?: string | null,
};

export type ModelSubscriptionLoginFormFilterInput = {
  id?: ModelSubscriptionIDInput | null,
  username?: ModelSubscriptionStringInput | null,
  password?: ModelSubscriptionStringInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  and?: Array< ModelSubscriptionLoginFormFilterInput | null > | null,
  or?: Array< ModelSubscriptionLoginFormFilterInput | null > | null,
};

export type ModelSubscriptionIDInput = {
  ne?: string | null,
  eq?: string | null,
  le?: string | null,
  lt?: string | null,
  ge?: string | null,
  gt?: string | null,
  contains?: string | null,
  notContains?: string | null,
  between?: Array< string | null > | null,
  beginsWith?: string | null,
  in?: Array< string | null > | null,
  notIn?: Array< string | null > | null,
};

export type ModelSubscriptionStringInput = {
  ne?: string | null,
  eq?: string | null,
  le?: string | null,
  lt?: string | null,
  ge?: string | null,
  gt?: string | null,
  contains?: string | null,
  notContains?: string | null,
  between?: Array< string | null > | null,
  beginsWith?: string | null,
  in?: Array< string | null > | null,
  notIn?: Array< string | null > | null,
};

export type ModelSubscriptionSNSAccountFilterInput = {
  id?: ModelSubscriptionIDInput | null,
  platform?: ModelSubscriptionStringInput | null,
  displayName?: ModelSubscriptionStringInput | null,
  accountId?: ModelSubscriptionStringInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  autoPost?: ModelSubscriptionBooleanInput | null,
  autoGenerate?: ModelSubscriptionBooleanInput | null,
  autoReply?: ModelSubscriptionBooleanInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  and?: Array< ModelSubscriptionSNSAccountFilterInput | null > | null,
  or?: Array< ModelSubscriptionSNSAccountFilterInput | null > | null,
  owner?: ModelStringInput | null,
};

export type ModelSubscriptionBooleanInput = {
  ne?: boolean | null,
  eq?: boolean | null,
};

export type CreateLoginFormMutationVariables = {
  input: CreateLoginFormInput,
  condition?: ModelLoginFormConditionInput | null,
};

export type CreateLoginFormMutation = {
  createLoginForm?:  {
    __typename: "LoginForm",
    id: string,
    username?: string | null,
    password?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type UpdateLoginFormMutationVariables = {
  input: UpdateLoginFormInput,
  condition?: ModelLoginFormConditionInput | null,
};

export type UpdateLoginFormMutation = {
  updateLoginForm?:  {
    __typename: "LoginForm",
    id: string,
    username?: string | null,
    password?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type DeleteLoginFormMutationVariables = {
  input: DeleteLoginFormInput,
  condition?: ModelLoginFormConditionInput | null,
};

export type DeleteLoginFormMutation = {
  deleteLoginForm?:  {
    __typename: "LoginForm",
    id: string,
    username?: string | null,
    password?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type CreateSNSAccountMutationVariables = {
  input: CreateSNSAccountInput,
  condition?: ModelSNSAccountConditionInput | null,
};

export type CreateSNSAccountMutation = {
  createSNSAccount?:  {
    __typename: "SNSAccount",
    id: string,
    platform: string,
    displayName: string,
    accountId: string,
    createdAt: string,
    autoPost: boolean,
    autoGenerate: boolean,
    autoReply: boolean,
    updatedAt: string,
    owner?: string | null,
  } | null,
};

export type UpdateSNSAccountMutationVariables = {
  input: UpdateSNSAccountInput,
  condition?: ModelSNSAccountConditionInput | null,
};

export type UpdateSNSAccountMutation = {
  updateSNSAccount?:  {
    __typename: "SNSAccount",
    id: string,
    platform: string,
    displayName: string,
    accountId: string,
    createdAt: string,
    autoPost: boolean,
    autoGenerate: boolean,
    autoReply: boolean,
    updatedAt: string,
    owner?: string | null,
  } | null,
};

export type DeleteSNSAccountMutationVariables = {
  input: DeleteSNSAccountInput,
  condition?: ModelSNSAccountConditionInput | null,
};

export type DeleteSNSAccountMutation = {
  deleteSNSAccount?:  {
    __typename: "SNSAccount",
    id: string,
    platform: string,
    displayName: string,
    accountId: string,
    createdAt: string,
    autoPost: boolean,
    autoGenerate: boolean,
    autoReply: boolean,
    updatedAt: string,
    owner?: string | null,
  } | null,
};

export type GetLoginFormQueryVariables = {
  id: string,
};

export type GetLoginFormQuery = {
  getLoginForm?:  {
    __typename: "LoginForm",
    id: string,
    username?: string | null,
    password?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type ListLoginFormsQueryVariables = {
  filter?: ModelLoginFormFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListLoginFormsQuery = {
  listLoginForms?:  {
    __typename: "ModelLoginFormConnection",
    items:  Array< {
      __typename: "LoginForm",
      id: string,
      username?: string | null,
      password?: string | null,
      createdAt: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type GetSNSAccountQueryVariables = {
  id: string,
};

export type GetSNSAccountQuery = {
  getSNSAccount?:  {
    __typename: "SNSAccount",
    id: string,
    platform: string,
    displayName: string,
    accountId: string,
    createdAt: string,
    autoPost: boolean,
    autoGenerate: boolean,
    autoReply: boolean,
    updatedAt: string,
    owner?: string | null,
  } | null,
};

export type ListSNSAccountsQueryVariables = {
  filter?: ModelSNSAccountFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListSNSAccountsQuery = {
  listSNSAccounts?:  {
    __typename: "ModelSNSAccountConnection",
    items:  Array< {
      __typename: "SNSAccount",
      id: string,
      platform: string,
      displayName: string,
      accountId: string,
      createdAt: string,
      autoPost: boolean,
      autoGenerate: boolean,
      autoReply: boolean,
      updatedAt: string,
      owner?: string | null,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type OnCreateLoginFormSubscriptionVariables = {
  filter?: ModelSubscriptionLoginFormFilterInput | null,
};

export type OnCreateLoginFormSubscription = {
  onCreateLoginForm?:  {
    __typename: "LoginForm",
    id: string,
    username?: string | null,
    password?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateLoginFormSubscriptionVariables = {
  filter?: ModelSubscriptionLoginFormFilterInput | null,
};

export type OnUpdateLoginFormSubscription = {
  onUpdateLoginForm?:  {
    __typename: "LoginForm",
    id: string,
    username?: string | null,
    password?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteLoginFormSubscriptionVariables = {
  filter?: ModelSubscriptionLoginFormFilterInput | null,
};

export type OnDeleteLoginFormSubscription = {
  onDeleteLoginForm?:  {
    __typename: "LoginForm",
    id: string,
    username?: string | null,
    password?: string | null,
    createdAt: string,
    updatedAt: string,
  } | null,
};

export type OnCreateSNSAccountSubscriptionVariables = {
  filter?: ModelSubscriptionSNSAccountFilterInput | null,
  owner?: string | null,
};

export type OnCreateSNSAccountSubscription = {
  onCreateSNSAccount?:  {
    __typename: "SNSAccount",
    id: string,
    platform: string,
    displayName: string,
    accountId: string,
    createdAt: string,
    autoPost: boolean,
    autoGenerate: boolean,
    autoReply: boolean,
    updatedAt: string,
    owner?: string | null,
  } | null,
};

export type OnUpdateSNSAccountSubscriptionVariables = {
  filter?: ModelSubscriptionSNSAccountFilterInput | null,
  owner?: string | null,
};

export type OnUpdateSNSAccountSubscription = {
  onUpdateSNSAccount?:  {
    __typename: "SNSAccount",
    id: string,
    platform: string,
    displayName: string,
    accountId: string,
    createdAt: string,
    autoPost: boolean,
    autoGenerate: boolean,
    autoReply: boolean,
    updatedAt: string,
    owner?: string | null,
  } | null,
};

export type OnDeleteSNSAccountSubscriptionVariables = {
  filter?: ModelSubscriptionSNSAccountFilterInput | null,
  owner?: string | null,
};

export type OnDeleteSNSAccountSubscription = {
  onDeleteSNSAccount?:  {
    __typename: "SNSAccount",
    id: string,
    platform: string,
    displayName: string,
    accountId: string,
    createdAt: string,
    autoPost: boolean,
    autoGenerate: boolean,
    autoReply: boolean,
    updatedAt: string,
    owner?: string | null,
  } | null,
};
