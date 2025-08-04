/***************************************************************************
 * The contents of this file were generated with Amplify Studio.           *
 * Please refrain from making any modifications to this file.              *
 * Any changes to this file will be overwritten when running amplify pull. *
 **************************************************************************/

/* eslint-disable */
import * as React from "react";
import {
  Button,
  Flex,
  Grid,
  SwitchField,
  TextField,
} from "@aws-amplify/ui-react";
import { fetchByPath, getOverrideProps, validateField } from "./utils";
import { generateClient } from "aws-amplify/api";
import { getSNSAccount } from "../graphql/queries";
import { updateSNSAccount } from "../graphql/mutations";
const client = generateClient();
export default function SNSAccountUpdateForm(props) {
  const {
    id: idProp,
    sNSAccount: sNSAccountModelProp,
    onSuccess,
    onError,
    onSubmit,
    onValidate,
    onChange,
    overrides,
    ...rest
  } = props;
  const initialValues = {
    platform: "",
    displayName: "",
    accountId: "",
    createdAt: "",
    autoPost: false,
    autoGenerate: false,
    autoReply: false,
  };
  const [platform, setPlatform] = React.useState(initialValues.platform);
  const [displayName, setDisplayName] = React.useState(
    initialValues.displayName
  );
  const [accountId, setAccountId] = React.useState(initialValues.accountId);
  const [createdAt, setCreatedAt] = React.useState(initialValues.createdAt);
  const [autoPost, setAutoPost] = React.useState(initialValues.autoPost);
  const [autoGenerate, setAutoGenerate] = React.useState(
    initialValues.autoGenerate
  );
  const [autoReply, setAutoReply] = React.useState(initialValues.autoReply);
  const [errors, setErrors] = React.useState({});
  const resetStateValues = () => {
    const cleanValues = sNSAccountRecord
      ? { ...initialValues, ...sNSAccountRecord }
      : initialValues;
    setPlatform(cleanValues.platform);
    setDisplayName(cleanValues.displayName);
    setAccountId(cleanValues.accountId);
    setCreatedAt(cleanValues.createdAt);
    setAutoPost(cleanValues.autoPost);
    setAutoGenerate(cleanValues.autoGenerate);
    setAutoReply(cleanValues.autoReply);
    setErrors({});
  };
  const [sNSAccountRecord, setSNSAccountRecord] =
    React.useState(sNSAccountModelProp);
  React.useEffect(() => {
    const queryData = async () => {
      const record = idProp
        ? (
            await client.graphql({
              query: getSNSAccount.replaceAll("__typename", ""),
              variables: { id: idProp },
            })
          )?.data?.getSNSAccount
        : sNSAccountModelProp;
      setSNSAccountRecord(record);
    };
    queryData();
  }, [idProp, sNSAccountModelProp]);
  React.useEffect(resetStateValues, [sNSAccountRecord]);
  const validations = {
    platform: [{ type: "Required" }],
    displayName: [{ type: "Required" }],
    accountId: [{ type: "Required" }],
    createdAt: [{ type: "Required" }],
    autoPost: [{ type: "Required" }],
    autoGenerate: [{ type: "Required" }],
    autoReply: [{ type: "Required" }],
  };
  const runValidationTasks = async (
    fieldName,
    currentValue,
    getDisplayValue
  ) => {
    const value =
      currentValue && getDisplayValue
        ? getDisplayValue(currentValue)
        : currentValue;
    let validationResponse = validateField(value, validations[fieldName]);
    const customValidator = fetchByPath(onValidate, fieldName);
    if (customValidator) {
      validationResponse = await customValidator(value, validationResponse);
    }
    setErrors((errors) => ({ ...errors, [fieldName]: validationResponse }));
    return validationResponse;
  };
  const convertToLocal = (date) => {
    const df = new Intl.DateTimeFormat("default", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      calendar: "iso8601",
      numberingSystem: "latn",
      hourCycle: "h23",
    });
    const parts = df.formatToParts(date).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  return (
    <Grid
      as="form"
      rowGap="15px"
      columnGap="15px"
      padding="20px"
      onSubmit={async (event) => {
        event.preventDefault();
        let modelFields = {
          platform,
          displayName,
          accountId,
          createdAt,
          autoPost,
          autoGenerate,
          autoReply,
        };
        const validationResponses = await Promise.all(
          Object.keys(validations).reduce((promises, fieldName) => {
            if (Array.isArray(modelFields[fieldName])) {
              promises.push(
                ...modelFields[fieldName].map((item) =>
                  runValidationTasks(fieldName, item)
                )
              );
              return promises;
            }
            promises.push(
              runValidationTasks(fieldName, modelFields[fieldName])
            );
            return promises;
          }, [])
        );
        if (validationResponses.some((r) => r.hasError)) {
          return;
        }
        if (onSubmit) {
          modelFields = onSubmit(modelFields);
        }
        try {
          Object.entries(modelFields).forEach(([key, value]) => {
            if (typeof value === "string" && value === "") {
              modelFields[key] = null;
            }
          });
          await client.graphql({
            query: updateSNSAccount.replaceAll("__typename", ""),
            variables: {
              input: {
                id: sNSAccountRecord.id,
                ...modelFields,
              },
            },
          });
          if (onSuccess) {
            onSuccess(modelFields);
          }
        } catch (err) {
          if (onError) {
            const messages = err.errors.map((e) => e.message).join("\n");
            onError(modelFields, messages);
          }
        }
      }}
      {...getOverrideProps(overrides, "SNSAccountUpdateForm")}
      {...rest}
    >
      <TextField
        label="Platform"
        isRequired={true}
        isReadOnly={false}
        value={platform}
        onChange={(e) => {
          let { value } = e.target;
          if (onChange) {
            const modelFields = {
              platform: value,
              displayName,
              accountId,
              createdAt,
              autoPost,
              autoGenerate,
              autoReply,
            };
            const result = onChange(modelFields);
            value = result?.platform ?? value;
          }
          if (errors.platform?.hasError) {
            runValidationTasks("platform", value);
          }
          setPlatform(value);
        }}
        onBlur={() => runValidationTasks("platform", platform)}
        errorMessage={errors.platform?.errorMessage}
        hasError={errors.platform?.hasError}
        {...getOverrideProps(overrides, "platform")}
      ></TextField>
      <TextField
        label="Display name"
        isRequired={true}
        isReadOnly={false}
        value={displayName}
        onChange={(e) => {
          let { value } = e.target;
          if (onChange) {
            const modelFields = {
              platform,
              displayName: value,
              accountId,
              createdAt,
              autoPost,
              autoGenerate,
              autoReply,
            };
            const result = onChange(modelFields);
            value = result?.displayName ?? value;
          }
          if (errors.displayName?.hasError) {
            runValidationTasks("displayName", value);
          }
          setDisplayName(value);
        }}
        onBlur={() => runValidationTasks("displayName", displayName)}
        errorMessage={errors.displayName?.errorMessage}
        hasError={errors.displayName?.hasError}
        {...getOverrideProps(overrides, "displayName")}
      ></TextField>
      <TextField
        label="Account id"
        isRequired={true}
        isReadOnly={false}
        value={accountId}
        onChange={(e) => {
          let { value } = e.target;
          if (onChange) {
            const modelFields = {
              platform,
              displayName,
              accountId: value,
              createdAt,
              autoPost,
              autoGenerate,
              autoReply,
            };
            const result = onChange(modelFields);
            value = result?.accountId ?? value;
          }
          if (errors.accountId?.hasError) {
            runValidationTasks("accountId", value);
          }
          setAccountId(value);
        }}
        onBlur={() => runValidationTasks("accountId", accountId)}
        errorMessage={errors.accountId?.errorMessage}
        hasError={errors.accountId?.hasError}
        {...getOverrideProps(overrides, "accountId")}
      ></TextField>
      <TextField
        label="Created at"
        isRequired={true}
        isReadOnly={false}
        type="datetime-local"
        value={createdAt && convertToLocal(new Date(createdAt))}
        onChange={(e) => {
          let value =
            e.target.value === "" ? "" : new Date(e.target.value).toISOString();
          if (onChange) {
            const modelFields = {
              platform,
              displayName,
              accountId,
              createdAt: value,
              autoPost,
              autoGenerate,
              autoReply,
            };
            const result = onChange(modelFields);
            value = result?.createdAt ?? value;
          }
          if (errors.createdAt?.hasError) {
            runValidationTasks("createdAt", value);
          }
          setCreatedAt(value);
        }}
        onBlur={() => runValidationTasks("createdAt", createdAt)}
        errorMessage={errors.createdAt?.errorMessage}
        hasError={errors.createdAt?.hasError}
        {...getOverrideProps(overrides, "createdAt")}
      ></TextField>
      <SwitchField
        label="Auto post"
        defaultChecked={false}
        isDisabled={false}
        isChecked={autoPost}
        onChange={(e) => {
          let value = e.target.checked;
          if (onChange) {
            const modelFields = {
              platform,
              displayName,
              accountId,
              createdAt,
              autoPost: value,
              autoGenerate,
              autoReply,
            };
            const result = onChange(modelFields);
            value = result?.autoPost ?? value;
          }
          if (errors.autoPost?.hasError) {
            runValidationTasks("autoPost", value);
          }
          setAutoPost(value);
        }}
        onBlur={() => runValidationTasks("autoPost", autoPost)}
        errorMessage={errors.autoPost?.errorMessage}
        hasError={errors.autoPost?.hasError}
        {...getOverrideProps(overrides, "autoPost")}
      ></SwitchField>
      <SwitchField
        label="Auto generate"
        defaultChecked={false}
        isDisabled={false}
        isChecked={autoGenerate}
        onChange={(e) => {
          let value = e.target.checked;
          if (onChange) {
            const modelFields = {
              platform,
              displayName,
              accountId,
              createdAt,
              autoPost,
              autoGenerate: value,
              autoReply,
            };
            const result = onChange(modelFields);
            value = result?.autoGenerate ?? value;
          }
          if (errors.autoGenerate?.hasError) {
            runValidationTasks("autoGenerate", value);
          }
          setAutoGenerate(value);
        }}
        onBlur={() => runValidationTasks("autoGenerate", autoGenerate)}
        errorMessage={errors.autoGenerate?.errorMessage}
        hasError={errors.autoGenerate?.hasError}
        {...getOverrideProps(overrides, "autoGenerate")}
      ></SwitchField>
      <SwitchField
        label="Auto reply"
        defaultChecked={false}
        isDisabled={false}
        isChecked={autoReply}
        onChange={(e) => {
          let value = e.target.checked;
          if (onChange) {
            const modelFields = {
              platform,
              displayName,
              accountId,
              createdAt,
              autoPost,
              autoGenerate,
              autoReply: value,
            };
            const result = onChange(modelFields);
            value = result?.autoReply ?? value;
          }
          if (errors.autoReply?.hasError) {
            runValidationTasks("autoReply", value);
          }
          setAutoReply(value);
        }}
        onBlur={() => runValidationTasks("autoReply", autoReply)}
        errorMessage={errors.autoReply?.errorMessage}
        hasError={errors.autoReply?.hasError}
        {...getOverrideProps(overrides, "autoReply")}
      ></SwitchField>
      <Flex
        justifyContent="space-between"
        {...getOverrideProps(overrides, "CTAFlex")}
      >
        <Button
          children="Reset"
          type="reset"
          onClick={(event) => {
            event.preventDefault();
            resetStateValues();
          }}
          isDisabled={!(idProp || sNSAccountModelProp)}
          {...getOverrideProps(overrides, "ResetButton")}
        ></Button>
        <Flex
          gap="15px"
          {...getOverrideProps(overrides, "RightAlignCTASubFlex")}
        >
          <Button
            children="Submit"
            type="submit"
            variation="primary"
            isDisabled={
              !(idProp || sNSAccountModelProp) ||
              Object.values(errors).some((e) => e?.hasError)
            }
            {...getOverrideProps(overrides, "SubmitButton")}
          ></Button>
        </Flex>
      </Flex>
    </Grid>
  );
}
