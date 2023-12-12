import React from 'react'
import { useState } from 'react'
import GetData from './GetData';
import PutData from './PutData';
import GetResult from './GetResult';
import GetRoundData from './GetRoundData';
import GetAccuracy from './GetAccuracy';

const Main = () => {

    const [login, setLogin] = useState(false);
    const [orgName, setOrgName] = useState("org1");
    const [userName, setUserName] = useState("appuser1");
    const [textdata, setTextData] = useState("");
    const [weightdata, setWeightdata] = useState("")

    const PORT=process.env.REACT_APP_BACKEND_PORT | process.env.PORT+2000;

    const handleOnClick = async (e) => {
        e.preventDefault();
        try {
            const result = await fetch(`http://localhost:${PORT}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ orgName, userName })
            });
            const data = await result.json();
            console.log(data);
            if(data.message==="Login Successful"){
                setLogin(true);
            }
        }
        catch (err) {
            console.log(err);
        }
    }

    return (
        <>
            {!login && (
                <div className="container card">
                    <form className='form'>
                        <div className='form-group m-3'>
                            <label>Organization Name</label>
                            <input
                                type='text'
                                className='form-control'
                                placeholder='Enter Organization Name'
                                required
                                onChange={(e) => setOrgName(e.target.value)}
                            />
                        </div>
                        <div className='form-group m-3'>
                            <label>User Name</label>
                            <input
                                type='text'
                                className='form-control'
                                placeholder='Enter User Name'
                                required
                                onChange={(e) => setUserName(e.target.value)}
                            />
                        </div>
                    </form>
                    <div className='btn btn-primary m-3' onClick={handleOnClick}>Login</div>
                </div>
            )}

            {login && (
                <div className='container'>
                    <div>
                        <div className="card">
                            <div className="card-header">
                                Organisation: {orgName}
                            </div>
                            <div className="card-body">
                                <h5 className="card-title">User: {userName}</h5>
                                <p className="card-text">Connected to: {PORT}</p>
                            </div>
                        </div>
                    </div>
                    <div className="row m-3">
                        {userName !== "appserver" && (<div className="col-4 card m-2">
                            <PutData setTextData={setTextData} setWeights={setWeightdata}/>
                        </div>)}
                        <div className="col-4 card m-2">
                            {userName === "appserver" && (
                                <GetRoundData setTextData={setTextData}/>
                            )}
                            {userName !== "appserver" && (
                                <div>
                                    <GetResult setTextData={setTextData}/>
                                    <GetAccuracy setTextData={setTextData}/>
                                </div>
                            )}
                        </div>
                        <div className="col-3">
                            <GetData setTextData={setTextData}/>
                        </div>
                    </div>
                    <div className="row m-3">
                        <div className="col-11 card">
                            <div className="card-header">
                                Response:
                            </div>
                            <div className="card-body">
                                <p className="card-text">{textdata}</p>
                                <p className="card-text">{weightdata}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}

export default Main