import React, { useState } from 'react'

const GetRoundData = (props) => {

    const [num, setNum] = useState("");
    const setTextData=props.setTextData;

    const PORT=process.env.REACT_APP_BACKEND_PORT | process.env.PORT+2000;

    const handleOnClick = async (e) => {
        e.preventDefault();
        if (num === "") {
            setTextData("Please enter round and number of clients");
            return;
        }
        try {
            const result = await fetch(`http://localhost:${PORT}/getroundweights`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ num })
            });
            const data = await result.json();
            console.log(data);
            let message=data.records;
            message="Get Round Weights: "+message;
            setTextData(message);
        }
        catch (err) {
            console.log(err);
            setTextData("Unable to Get Round Data");
        }
    }
    return (
        <div className='m-3'>
            <div className="card-header">Get next round weights, Calculate average, push it to ledger</div>
            <form className='form'>
                <div className='form-group m-3'>
                    <label>Number of Clients</label>
                    <input
                        type='text'
                        className='form-control'
                        placeholder='Enter Number of Clients to be selected'
                        required
                        onChange={(e) => setNum(e.target.value)}
                    />
                </div>
            </form>
            <div className="btn btn-primary mt-1 mx-3" onClick={handleOnClick}>Submit</div>
        </div>
    )
}

export default GetRoundData